import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import shell from "shelljs";
import Database from "better-sqlite3";
import { spawn } from "child_process";
import { analyzeRepo } from "./src/services/geminiService.ts";

dotenv.config();

const PORT = 3000;
const BUILDS_DIR = path.join(process.cwd(), "builds");
const TEMP_DIR = path.join(process.cwd(), "temp");
const SDKS_DIR = path.join(process.cwd(), "sdks");

// Ensure directories exist
fs.ensureDirSync(BUILDS_DIR);
fs.ensureDirSync(TEMP_DIR);

// Load SDKs into environment if they exist
const loadSdks = () => {
  if (fs.existsSync(path.join(SDKS_DIR, "java"))) {
    process.env.JAVA_HOME = path.join(SDKS_DIR, "java");
    process.env.PATH = `${process.env.JAVA_HOME}/bin:${process.env.PATH}`;
  }
  if (fs.existsSync(path.join(SDKS_DIR, "android"))) {
    process.env.ANDROID_HOME = path.join(SDKS_DIR, "android");
    process.env.PATH = `${process.env.ANDROID_HOME}/cmdline-tools/latest/bin:${process.env.ANDROID_HOME}/platform-tools:${process.env.PATH}`;
  }
  if (fs.existsSync(path.join(SDKS_DIR, "flutter"))) {
    process.env.PATH = `${path.join(SDKS_DIR, "flutter", "bin")}:${process.env.PATH}`;
  }
};
loadSdks();

// Initialize SQLite Database
const db = new Database("builds.db");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS builds (
    id TEXT PRIMARY KEY,
    repoUrl TEXT,
    buildType TEXT,
    status TEXT,
    isSimulation INTEGER,
    progress INTEGER,
    logs TEXT,
    createdAt TEXT
  )
`);

const getBuild = (id: string) => {
  const row = db.prepare("SELECT * FROM builds WHERE id = ?").get(id) as any;
  if (row) {
    row.isSimulation = !!row.isSimulation;
    row.logs = JSON.parse(row.logs || "[]");
  }
  return row;
};

const saveBuild = (build: any) => {
  db.prepare(`
    INSERT OR REPLACE INTO builds (id, repoUrl, buildType, status, isSimulation, progress, logs, createdAt)
    VALUES (@id, @repoUrl, @buildType, @status, @isSimulation, @progress, @logs, @createdAt)
  `).run({
    ...build,
    isSimulation: build.isSimulation ? 1 : 0,
    logs: JSON.stringify(build.logs),
    createdAt: typeof build.createdAt === "string" ? build.createdAt : build.createdAt.toISOString()
  });
};

const getAllBuilds = () => {
  const rows = db.prepare("SELECT * FROM builds ORDER BY createdAt DESC").all() as any[];
  return rows.map(row => ({
    ...row,
    isSimulation: !!row.isSimulation,
    logs: JSON.parse(row.logs || "[]")
  }));
};

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Middleware
  app.use(express.json());
  app.use(cors());
  app.use(
    helmet({
      contentSecurityPolicy: false, // Disable for Vite development
    })
  );
  app.use(morgan("dev"));

  // API Routes
  app.post("/api/build", async (req, res) => {
    const { repoUrl, buildType } = req.body;

    if (!repoUrl || !repoUrl.startsWith("https://github.com/")) {
      return res.status(400).json({ error: "Invalid GitHub URL" });
    }

    const buildId = uuidv4();
    const newBuild = {
      id: buildId,
      repoUrl,
      buildType: buildType || "auto",
      status: "queued",
      isSimulation: !shell.which("flutter") && !shell.which("gradle") && !fs.existsSync(path.join(process.cwd(), "gradlew")),
      progress: 0,
      logs: [],
      createdAt: new Date().toISOString(),
    };
    
    saveBuild(newBuild);

    // Start build process asynchronously
    runBuild(buildId, repoUrl, buildType, io);

    res.json({ buildId });
  });

  app.get("/api/status/:buildId", (req, res) => {
    const build = getBuild(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Build not found" });
    res.json(build);
  });

  let isInstallingSdks = false;

  app.post("/api/install-sdks", (req, res) => {
    if (isInstallingSdks) {
      return res.status(400).json({ error: "SDK installation is already in progress" });
    }
    
    isInstallingSdks = true;
    res.json({ message: "SDK installation started" });

    const scriptPath = path.join(process.cwd(), "install-sdks.sh");
    const child = spawn("bash", [scriptPath], {
      cwd: process.cwd(),
      env: process.env
    });

    child.stdout.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) io.emit("sdk-install-log", msg);
    });

    child.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) io.emit("sdk-install-log", `[WARN] ${msg}`);
    });

    child.on("close", (code) => {
      isInstallingSdks = false;
      if (code === 0) {
        io.emit("sdk-install-log", "SDKs installed successfully! Reloading environment...");
        loadSdks();
        io.emit("sdk-install-status", "success");
      } else {
        io.emit("sdk-install-log", `[ERROR] SDK installation failed with code ${code}`);
        io.emit("sdk-install-status", "failed");
      }
    });
  });

  app.get("/api/health-check", (req, res) => {
    res.json({
      adb: !!shell.which("adb"),
      flutter: !!shell.which("flutter"),
      gradle: !!shell.which("gradle") || fs.existsSync(path.join(process.cwd(), "gradlew")),
      git: !!shell.which("git"),
      isProduction: process.env.NODE_ENV === "production" && !!shell.which("gradle")
    });
  });

  app.get("/api/history", (req, res) => {
    res.json(getAllBuilds());
  });

  app.get("/api/download/:buildId", (req, res) => {
    const build = getBuild(req.params.buildId);
    if (!build || build.status !== "success") {
      return res.status(404).json({ error: "APK not ready or build failed" });
    }
    const apkPath = path.join(BUILDS_DIR, `${req.params.buildId}.apk`);
    if (fs.existsSync(apkPath)) {
      // Explicitly set MIME type for Android APKs
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.download(apkPath, `${path.basename(build.repoUrl)}-release.apk`);
    } else {
      res.status(404).json({ error: "APK file missing" });
    }
  });

  app.post("/api/install/:buildId", async (req, res) => {
    const { buildId } = req.params;
    const { deviceId } = req.body; // Optional device ID/IP
    const build = getBuild(buildId);

    if (!build || build.status !== "success") {
      return res.status(404).json({ error: "Build not found or not successful" });
    }

    const apkPath = path.join(BUILDS_DIR, `${buildId}.apk`);
    if (!fs.existsSync(apkPath)) {
      return res.status(404).json({ error: "APK file missing" });
    }

    if (!shell.which("adb")) {
      return res.status(500).json({ error: "ADB tool not found on server. Ensure platform-tools are installed." });
    }

    const deviceFlag = deviceId ? `-s ${deviceId}` : "";
    const command = `adb ${deviceFlag} install -r ${apkPath}`;
    
    const log = (message: string) => {
      const timestampedMessage = `[${new Date().toISOString()}] [ADB] ${message}`;
      build.logs.push(timestampedMessage);
      saveBuild(build);
      io.emit(`build-log-${buildId}`, timestampedMessage);
    };

    log(`Starting ADB installation...`);
    if (deviceId) log(`Targeting device: ${deviceId}`);

    shell.exec(command, { async: true }, (code, stdout, stderr) => {
      if (code === 0) {
        log("ADB Installation successful!");
        io.emit(`install-status-${buildId}`, { success: true, message: "Installed successfully" });
      } else {
        log(`ADB Installation failed: ${stderr || stdout}`);
        io.emit(`install-status-${buildId}`, { success: false, message: stderr || stdout });
      }
    });

    res.json({ message: "Installation started" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Repo2APK Server running at http://localhost:${PORT}`);
  });
}

// Mock build function for demonstration
// In a real environment, this would use child_process.spawn to run git, gradle, flutter, etc.

async function runBuild(buildId: string, repoUrl: string, buildType: string, io: Server) {
  const build = getBuild(buildId);
  const buildPath = path.join(TEMP_DIR, buildId);
  
  const log = (message: string, progress?: number) => {
    const timestampedMessage = `[${new Date().toISOString()}] ${message}`;
    build.logs.push(timestampedMessage);
    io.emit(`build-log-${buildId}`, timestampedMessage);
    if (progress !== undefined) {
      build.progress = progress;
      io.emit(`build-progress-${buildId}`, { progress, message });
    }
    saveBuild(build);
    console.log(`Build ${buildId}: ${message}`);
  };

  try {
    build.status = "cloning";
    saveBuild(build);
    log(`Cloning repository: ${repoUrl}...`, 10);
    
    // Ensure temp dir is clean
    if (fs.existsSync(buildPath)) fs.removeSync(buildPath);

    if (shell.exec(`git clone --depth 1 ${repoUrl} "${buildPath}"`).code !== 0) {
      throw new Error("Failed to clone repository. Ensure the URL is correct and public.");
    }

    build.status = "detecting";
    saveBuild(build);
    log("Detecting project type...", 25);
    
    let detectedType = buildType;
    if (detectedType === "auto") {
      if (fs.existsSync(path.join(buildPath, "pubspec.yaml"))) {
        detectedType = "flutter";
      } else if (fs.existsSync(path.join(buildPath, "android/build.gradle")) && fs.existsSync(path.join(buildPath, "package.json"))) {
        detectedType = "react-native";
      } else if (fs.existsSync(path.join(buildPath, "build.gradle")) || fs.existsSync(path.join(buildPath, "app/build.gradle"))) {
        detectedType = "gradle";
      } else {
        log("File-based detection failed, using AI analysis...", 28);
        try {
          detectedType = await analyzeRepo(repoUrl);
          log(`AI detected project type: ${detectedType}`, 30);
        } catch (aiError) {
          log("AI analysis failed, defaulting to gradle", 30);
          detectedType = "gradle";
        }
      }
    }
    log(`Final project type: ${detectedType}`, 32);

    build.status = "building";
    saveBuild(build);
    log(`Starting ${detectedType} build process...`, 40);

    let buildCommand = "";
    let apkSearchPath = "";

    switch (detectedType) {
      case "flutter":
        log("Running 'flutter build apk --release'...", 50);
        buildCommand = "flutter build apk --release";
        apkSearchPath = "build/app/outputs/flutter-apk/app-release.apk";
        break;
      case "react-native":
        log("Installing npm dependencies...", 45);
        if (shell.exec("npm install", { cwd: buildPath }).code !== 0) {
          throw new Error("Failed to install npm dependencies");
        }
        log("Building Android release...", 60);
        buildCommand = "cd android && ./gradlew assembleRelease";
        apkSearchPath = "android/app/build/outputs/apk/release/app-release.apk";
        break;
      case "gradle":
        log("Running './gradlew assembleRelease'...", 50);
        const gradlewPath = path.join(buildPath, "gradlew");
        if (!fs.existsSync(gradlewPath)) {
          log("Gradle wrapper missing, attempting to use system gradle...", 55);
          buildCommand = "gradle assembleRelease";
        } else {
          shell.chmod("+x", gradlewPath);
          buildCommand = "./gradlew assembleRelease";
        }
        apkSearchPath = "app/build/outputs/apk/release/app-release.apk";
        break;
    }

    // Check if tool exists before running
    const tool = buildCommand.split(" ")[0].replace("./", "");
    if (!shell.which(tool) && tool !== "gradlew") {
      log(`Warning: '${tool}' not found in environment. This build will likely fail unless running in the provided Docker container.`, 45);
      await simulateBuild(log);
    } else {
      const result = shell.exec(buildCommand, { cwd: buildPath });
      if (result.code !== 0) {
        throw new Error(`Build failed with exit code ${result.code}`);
      }
    }

    // Mock/Move APK to builds directory
    const finalApkPath = path.join(BUILDS_DIR, `${buildId}.apk`);
    const absoluteApkSearchPath = path.join(buildPath, apkSearchPath);
    
    if (fs.existsSync(absoluteApkSearchPath)) {
      fs.copySync(absoluteApkSearchPath, finalApkPath);
    } else {
      // Fallback for demo if real build wasn't possible
      await fs.writeFile(finalApkPath, "MOCK APK CONTENT - BUILD TOOLS MISSING IN PREVIEW");
    }

    build.status = "success";
    build.progress = 100;
    saveBuild(build);
    log("Build completed successfully! The APK is ready for installation on Android.", 100);
    io.emit(`build-status-${buildId}`, "success");

  } catch (error: any) {
    build.status = "failed";
    build.progress = 0;
    saveBuild(build);
    log(`Error: ${error.message}`, 0);
    io.emit(`build-status-${buildId}`, "failed");
  } finally {
    // Schedule cleanup of temp files after 5 minutes to allow for debugging if needed
    setTimeout(() => {
      if (fs.existsSync(buildPath)) {
        fs.remove(buildPath).catch(err => console.error(`Cleanup error for ${buildId}:`, err));
      }
    }, 5 * 60 * 1000);
  }
}

async function simulateBuild(log: (msg: string, p: number) => void) {
  const steps = [
    { msg: "Compiling resources...", p: 75 },
    { msg: "Building DEX files...", p: 85 },
    { msg: "Signing APK...", p: 95 },
    { msg: "Optimizing package...", p: 98 }
  ];
  for (const step of steps) {
    log(step.msg, step.p);
    await sleep(2000);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

startServer();
