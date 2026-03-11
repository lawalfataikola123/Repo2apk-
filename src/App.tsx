import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { 
  Github, 
  Cpu, 
  Download, 
  Terminal as TerminalIcon, 
  Play, 
  History, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  ChevronRight,
  AlertCircle,
  Server
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';

interface Build {
  id: string;
  repoUrl: string;
  buildType: string;
  status: 'queued' | 'cloning' | 'detecting' | 'building' | 'success' | 'failed';
  isSimulation?: boolean;
  progress?: number;
  logs: string[];
  createdAt: string;
}

export default function App() {
  const [repoUrl, setRepoUrl] = useState('');
  const [buildType, setBuildType] = useState('auto');
  const [currentBuildId, setCurrentBuildId] = useState<string | null>(null);
  const [buildStatus, setBuildStatus] = useState<Build | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [history, setHistory] = useState<Build[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [systemHealth, setSystemHealth] = useState<{ adb: boolean, flutter: boolean, gradle: boolean, git: boolean, isProduction: boolean } | null>(null);
  const [activeTab, setActiveTab] = useState<'build' | 'deploy'>('build');
  const [deviceId, setDeviceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'modern' | 'terminal'>('modern');
  const [isInstallingSdks, setIsInstallingSdks] = useState(false);
  const [sdkLogs, setSdkLogs] = useState<string[]>([]);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const sdkScrollRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const isBuildingRef = useRef(isBuilding);

  useEffect(() => {
    isBuildingRef.current = isBuilding;
  }, [isBuilding]);

  useEffect(() => {
    socketRef.current = io();
    
    socketRef.current.on('disconnect', () => {
      console.log('Disconnected from build server');
      if (isBuildingRef.current) {
        setIsBuilding(false);
        setError('Server connection lost. Build status unknown.');
      }
      setIsInstallingSdks(false);
    });

    socketRef.current.on('sdk-install-log', (log: string) => {
      setSdkLogs((prev) => [...prev, log]);
    });

    socketRef.current.on('sdk-install-status', (status: string) => {
      setIsInstallingSdks(false);
      fetchSystemHealth();
    });

    fetchHistory();
    fetchSystemHealth();

    const healthInterval = setInterval(fetchSystemHealth, 10000);
    return () => {
      socketRef.current?.disconnect();
      clearInterval(healthInterval);
    };
  }, []);

  const fetchSystemHealth = async () => {
    try {
      const res = await axios.get('/api/health-check');
      setSystemHealth(res.data);
    } catch (err) {
      console.error('Failed to fetch health', err);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (sdkScrollRef.current) {
      sdkScrollRef.current.scrollTop = sdkScrollRef.current.scrollHeight;
    }
  }, [sdkLogs]);

  const installSdks = async () => {
    setIsInstallingSdks(true);
    setSdkLogs([]);
    try {
      await axios.post('/api/install-sdks');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to start SDK installation');
      setIsInstallingSdks(false);
    }
  };

  useEffect(() => {
    if (currentBuildId) {
      const socket = socketRef.current;
      if (!socket) return;

      socket.on(`build-log-${currentBuildId}`, (log: string) => {
        setLogs((prev) => [...prev, log]);
      });

      socket.on(`build-progress-${currentBuildId}`, (data: { progress: number, message: string }) => {
        setProgress(data.progress);
        setCurrentStep(data.message);
      });

      socket.on(`install-status-${currentBuildId}`, (data: { success: boolean, message: string }) => {
        setIsInstalling(false);
        if (!data.success) {
          setError(`ADB Install Failed: ${data.message}`);
        }
      });

      socket.on(`build-status-${currentBuildId}`, (status: string) => {
        fetchBuildStatus(currentBuildId);
        if (status === 'success' || status === 'failed') {
          setIsBuilding(false);
          if (status === 'success') setProgress(100);
          fetchHistory();
        }
      });

      return () => {
        socket.off(`build-log-${currentBuildId}`);
        socket.off(`build-progress-${currentBuildId}`);
        socket.off(`install-status-${currentBuildId}`);
        socket.off(`build-status-${currentBuildId}`);
      };
    }
  }, [currentBuildId]);

  const fetchHistory = async () => {
    try {
      const res = await axios.get('/api/history');
      setHistory(res.data);
    } catch (err) {
      console.error('Failed to fetch history', err);
    }
  };

  const fetchBuildStatus = async (id: string) => {
    try {
      const res = await axios.get(`/api/status/${id}`);
      setBuildStatus(res.data);
      setLogs(res.data.logs);
      if (res.data.progress) setProgress(res.data.progress);
    } catch (err) {
      console.error('Failed to fetch build status', err);
    }
  };

  const startBuild = async () => {
    if (!repoUrl) {
      setError('Please enter a GitHub repository URL');
      return;
    }
    setError(null);
    setIsBuilding(true);
    setLogs([]);
    setProgress(0);
    setCurrentStep('Initializing...');
    setBuildStatus(null);

    try {
      const res = await axios.post('/api/build', { repoUrl, buildType });
      setCurrentBuildId(res.data.buildId);
      fetchBuildStatus(res.data.buildId);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to start build');
      setIsBuilding(false);
    }
  };

  const installViaAdb = async () => {
    if (!currentBuildId) return;
    setIsInstalling(true);
    setError(null);
    try {
      await axios.post(`/api/install/${currentBuildId}`, { deviceId });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to trigger installation');
      setIsInstalling(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-emerald-400';
      case 'failed': return 'text-rose-400';
      default: return 'text-sky-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
      case 'failed': return <XCircle className="w-5 h-5 text-rose-400" />;
      default: return <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />;
    }
  };

  return (
    <div className={cn(
      "min-h-screen font-sans selection:bg-sky-500/30 transition-colors duration-500",
      theme === 'modern' ? "bg-[#0a0a0a] text-zinc-100" : "bg-black text-green-500 font-mono"
    )}>
      {/* Background Gradient */}
      {theme === 'modern' && <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_-20%,#1e293b,transparent)] pointer-events-none" />}
      
      <header className={cn(
        "relative z-10 border-b backdrop-blur-xl",
        theme === 'modern' ? "border-white/5 bg-black/20" : "border-green-500/30 bg-black"
      )}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-sky-500 rounded-lg flex items-center justify-center shadow-lg shadow-sky-500/20">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Repo<span className="text-sky-500">2APK</span></h1>
          </div>
          
          <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10">
            <div className={cn("w-2 h-2 rounded-full", systemHealth?.isProduction ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-amber-500 shadow-[0_0_8px_#f59e0b]")} />
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              {systemHealth?.isProduction ? "Production Mode" : "Simulation Mode"}
            </span>
          </div>

          <nav className="flex items-center gap-6 text-sm font-medium text-zinc-400">
            <button 
              onClick={() => setTheme(theme === 'modern' ? 'terminal' : 'modern')}
              className="hover:text-white transition-colors flex items-center gap-2"
              title="Toggle Terminal Theme"
            >
              <TerminalIcon className="w-4 h-4" />
              <span className="hidden sm:inline">{theme === 'modern' ? 'Terminal' : 'Modern'}</span>
            </button>
            <button 
              onClick={() => setActiveTab('build')}
              className={cn("hover:text-white transition-colors", activeTab === 'build' && "text-white")}
            >
              Build
            </button>
            <button 
              onClick={() => setActiveTab('deploy')}
              className={cn("hover:text-white transition-colors", activeTab === 'deploy' && "text-white")}
            >
              Deploy Real App
            </button>
            <button className="px-4 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all">
              Sign In
            </button>
          </nav>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12">
        {activeTab === 'deploy' ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-3xl mx-auto space-y-8"
          >
            <div className="text-center space-y-4">
              <h2 className="text-4xl font-black tracking-tight">Get Real, Installable APKs</h2>
              <p className="text-zinc-400 text-lg">
                The browser preview is a simulation. To build real apps, you must deploy Repo2APK to your own server.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Android SDK', status: systemHealth?.gradle },
                { label: 'Flutter SDK', status: systemHealth?.flutter },
                { label: 'Node.js', status: true },
                { label: 'Git', status: systemHealth?.git }
              ].map((item) => (
                <div key={item.label} className="p-4 bg-white/5 border border-white/10 rounded-2xl text-center space-y-2">
                  <div className={cn("mx-auto w-2 h-2 rounded-full", item.status ? "bg-emerald-500" : "bg-rose-500")} />
                  <div className="text-[10px] font-bold uppercase text-zinc-500">{item.label}</div>
                  <div className="text-xs font-bold">{item.status ? 'Ready' : 'Missing'}</div>
                </div>
              ))}
            </div>

            <div className="p-8 bg-zinc-900 border border-white/10 rounded-3xl space-y-6">
              <h3 className="text-xl font-bold flex items-center gap-3">
                <TerminalIcon className="w-6 h-6 text-sky-500" />
                One-Command Deployment
              </h3>
              <p className="text-sm text-zinc-400">
                Run this on any Linux server (Ubuntu recommended) with Docker installed. It will automatically download the 10GB+ build tools required.
              </p>
              <div className="relative group">
                <pre className="p-6 bg-black rounded-2xl font-mono text-sm text-sky-400 overflow-x-auto border border-white/5">
                  git clone https://github.com/your-repo/repo2apk.git<br />
                  cd repo2apk<br />
                  docker-compose up -d --build
                </pre>
                <button className="absolute top-4 right-4 p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-all opacity-0 group-hover:opacity-100">
                  <CheckCircle2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-4 p-4 bg-sky-500/10 border border-sky-500/20 rounded-2xl">
                <AlertCircle className="w-6 h-6 text-sky-400 shrink-0" />
                <p className="text-xs text-sky-400/80 leading-relaxed">
                  <strong>Why is this necessary?</strong> Real APKs must be digitally signed and compiled using Google's official build tools, which are too large to run inside a web browser's preview mode.
                </p>
              </div>
            </div>

            <div className="p-8 bg-zinc-900 border border-white/10 rounded-3xl space-y-6">
              <h3 className="text-xl font-bold flex items-center gap-3">
                <Server className="w-6 h-6 text-emerald-500" />
                Install SDKs in Current Environment
              </h3>
              <p className="text-sm text-zinc-400">
                Alternatively, you can attempt to download and install the Android SDK, Java, and Flutter SDK directly into this container. 
                <strong className="text-amber-400 block mt-2">Warning: This downloads ~3GB of data and takes 5-10 minutes. It may crash the preview environment if memory limits are exceeded.</strong>
              </p>
              
              <button 
                onClick={installSdks}
                disabled={isInstallingSdks || (systemHealth?.gradle && systemHealth?.flutter)}
                className={cn(
                  "w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg",
                  (isInstallingSdks || (systemHealth?.gradle && systemHealth?.flutter))
                    ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" 
                    : "bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-500/20 active:scale-95"
                )}
              >
                {isInstallingSdks ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                {systemHealth?.gradle && systemHealth?.flutter ? 'SDKs Already Installed' : isInstallingSdks ? 'Installing SDKs...' : 'Download & Install SDKs'}
              </button>

              {sdkLogs.length > 0 && (
                <div className="relative bg-black border border-white/10 rounded-2xl overflow-hidden shadow-2xl mt-4">
                  <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900/50 border-b border-white/5">
                    <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                      Installation Logs
                    </div>
                  </div>
                  <div 
                    ref={sdkScrollRef}
                    className="h-[200px] overflow-y-auto p-4 font-mono text-xs leading-relaxed scrollbar-thin scrollbar-thumb-zinc-800"
                  >
                    <div className="space-y-1">
                      {sdkLogs.map((log, i) => (
                        <div key={i} className={cn(
                          log.includes('ERROR') || log.includes('WARN') ? 'text-rose-400' : 
                          log.includes('successfully') ? 'text-emerald-400' : 
                          'text-zinc-300'
                        )}>
                          {log}
                        </div>
                      ))}
                      {isInstallingSdks && (
                        <div className="animate-pulse text-sky-400">_</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
            {/* ... existing build UI ... */}
        {/* Left Column: Input & Controls */}
        <div className="lg:col-span-5 space-y-8">
          <div className="space-y-4">
            <h2 className="text-4xl font-extrabold tracking-tight lg:text-5xl">
              Build Android Apps <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-400">
                Directly from GitHub
              </span>
            </h2>
            <p className="text-zinc-400 text-lg max-w-md">
              The ultimate cloud pipeline for converting your repositories into production-ready APKs.
            </p>
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-3 text-amber-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-bold">Preview Environment Notice:</p>
                <p>Real APK generation requires the full Android SDK (included in the Dockerfile). In this preview, we simulate the build and provide a mock file for UI testing. Deploy via Docker for real APKs.</p>
              </div>
            </div>
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-3 text-rose-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Note: iOS builds (IPA) require macOS and are not supported.</span>
            </div>
          </div>

          <div className={cn(
            "p-6 border rounded-2xl space-y-6 backdrop-blur-sm transition-colors",
            theme === 'modern' ? "bg-zinc-900/50 border-white/5" : "bg-black border-green-500/30"
          )}>
            <div className="space-y-2">
              <label className={cn("text-sm font-semibold uppercase tracking-wider", theme === 'modern' ? "text-zinc-400" : "text-green-600")}>GitHub Repository URL</label>
              <div className="relative">
                <Github className={cn("absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5", theme === 'modern' ? "text-zinc-500" : "text-green-600")} />
                <input 
                  type="text" 
                  placeholder="https://github.com/username/repo"
                  className={cn(
                    "w-full pl-12 pr-4 py-3.5 border rounded-xl focus:outline-none focus:ring-2 transition-all",
                    theme === 'modern' 
                      ? "bg-black/40 border-white/10 focus:ring-sky-500/50 placeholder:text-zinc-600" 
                      : "bg-black border-green-500/30 focus:ring-green-500/50 text-green-500 placeholder:text-green-800"
                  )}
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className={cn("text-sm font-semibold uppercase tracking-wider", theme === 'modern' ? "text-zinc-400" : "text-green-600")}>Build Engine</label>
                <select 
                  className={cn(
                    "w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 transition-all appearance-none",
                    theme === 'modern'
                      ? "bg-black/40 border-white/10 focus:ring-sky-500/50"
                      : "bg-black border-green-500/30 focus:ring-green-500/50 text-green-500"
                  )}
                  value={buildType}
                  onChange={(e) => setBuildType(e.target.value)}
                >
                  <option value="auto">Auto Detect</option>
                  <option value="gradle">Native Gradle</option>
                  <option value="flutter">Flutter SDK</option>
                  <option value="react-native">React Native</option>
                </select>
              </div>
              <div className="flex items-end">
                <button 
                  onClick={startBuild}
                  disabled={isBuilding}
                  className={cn(
                    "w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg",
                    isBuilding 
                      ? (theme === 'modern' ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" : "bg-green-900/20 text-green-800 border border-green-900 cursor-not-allowed")
                      : (theme === 'modern' ? "bg-sky-500 hover:bg-sky-400 text-white shadow-sky-500/20 active:scale-95" : "bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/50 active:scale-95")
                  )}
                >
                  {isBuilding ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
                  {isBuilding ? 'Building...' : 'Start Build'}
                </button>
              </div>
            </div>

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-3 text-rose-400 text-sm"
              >
                <AlertCircle className="w-5 h-5 shrink-0" />
                {error}
              </motion.div>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <History className="w-5 h-5 text-sky-500" />
                Recent Builds
              </h3>
              <button className="text-xs font-bold text-sky-500 hover:text-sky-400 uppercase tracking-widest">View All</button>
            </div>
            <div className="space-y-3">
              {history.length === 0 ? (
                <div className="py-8 text-center border border-dashed border-white/10 rounded-2xl text-zinc-500 text-sm">
                  No build history yet
                </div>
              ) : (
                history.slice(0, 4).map((build) => (
                  <div key={build.id} className="p-4 bg-white/5 border border-white/5 rounded-xl flex items-center justify-between hover:bg-white/10 transition-colors group">
                    <div className="flex items-center gap-4">
                      <div className={cn("w-2 h-2 rounded-full", build.status === 'success' ? 'bg-emerald-500' : build.status === 'failed' ? 'bg-rose-500' : 'bg-sky-500 animate-pulse')} />
                      <div>
                        <div className="text-sm font-bold truncate max-w-[180px]">{build.repoUrl.split('/').pop()}</div>
                        <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-tighter">{new Date(build.createdAt).toLocaleString()}</div>
                      </div>
                    </div>
                    {build.status === 'success' ? (
                      <a 
                        href={`/api/download/${build.id}`}
                        className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    ) : (
                      <ChevronRight className="w-4 h-4 text-zinc-600" />
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Terminal & Status */}
        <div className="lg:col-span-7 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center border border-white/5">
                <TerminalIcon className="w-5 h-5 text-zinc-400" />
              </div>
              <div>
                <h3 className="font-bold">Build Console</h3>
                <p className="text-xs text-zinc-500">Real-time compilation logs</p>
              </div>
            </div>
            {buildStatus && (
              <div className="flex items-center gap-3 px-4 py-2 bg-white/5 rounded-full border border-white/5">
                {getStatusIcon(buildStatus.status)}
                <span className={cn("text-xs font-bold uppercase tracking-widest", getStatusColor(buildStatus.status))}>
                  {buildStatus.status}
                </span>
              </div>
            )}
          </div>

          {/* Progress Bar */}
          <AnimatePresence>
            {(isBuilding || buildStatus?.status === 'success' || buildStatus?.status === 'failed') && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-3"
              >
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Current Step</span>
                    <p className="text-sm font-medium text-sky-400 flex items-center gap-2">
                      {isBuilding && <Loader2 className="w-3 h-3 animate-spin" />}
                      {currentStep || 'Ready'}
                    </p>
                  </div>
                  <span className="text-2xl font-black text-white tabular-nums">{progress}%</span>
                </div>
                <div className="h-3 bg-zinc-900 rounded-full border border-white/5 overflow-hidden p-0.5">
                  <motion.div 
                    className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 rounded-full shadow-[0_0_15px_rgba(14,165,233,0.4)]"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-bold text-zinc-600 uppercase tracking-tighter">
                  <span>Clone</span>
                  <span>Detect</span>
                  <span>Install</span>
                  <span>Compile</span>
                  <span>Sign</span>
                  <span>Finish</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative group">
            <div className={cn(
              "absolute -inset-0.5 rounded-2xl blur opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200",
              theme === 'modern' ? "bg-gradient-to-r from-sky-500/20 to-indigo-500/20" : "bg-green-500/20"
            )} />
            <div className={cn(
              "relative bg-black border rounded-2xl overflow-hidden shadow-2xl",
              theme === 'modern' ? "border-white/10" : "border-green-500/50"
            )}>
              <div className={cn(
                "flex items-center gap-2 px-4 py-2 border-b",
                theme === 'modern' ? "bg-zinc-900/50 border-white/5" : "bg-black border-green-500/30"
              )}>
                <div className="flex gap-1.5">
                  <div className={cn("w-2.5 h-2.5 rounded-full", theme === 'modern' ? "bg-rose-500/50" : "bg-green-500/50")} />
                  <div className={cn("w-2.5 h-2.5 rounded-full", theme === 'modern' ? "bg-amber-500/50" : "bg-green-500/50")} />
                  <div className={cn("w-2.5 h-2.5 rounded-full", theme === 'modern' ? "bg-emerald-500/50" : "bg-green-500/50")} />
                </div>
                <div className={cn(
                  "mx-auto text-[10px] font-mono uppercase tracking-widest",
                  theme === 'modern' ? "text-zinc-500" : "text-green-600"
                )}>
                  {currentBuildId || 'No Active Session'}
                </div>
              </div>
              <div 
                ref={scrollRef}
                className={cn(
                  "h-[500px] overflow-y-auto p-6 font-mono text-sm leading-relaxed scrollbar-thin",
                  theme === 'modern' ? "scrollbar-thumb-zinc-800" : "scrollbar-thumb-green-900/50"
                )}
              >
                {logs.length === 0 ? (
                  <div className={cn("h-full flex flex-col items-center justify-center space-y-4", theme === 'modern' ? "text-zinc-600" : "text-green-800")}>
                    <TerminalIcon className="w-12 h-12 opacity-20" />
                    <p className="text-center max-w-xs">
                      Enter a repository URL and click "Start Build" to begin the APK generation process.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {logs.map((log, i) => (
                      <div key={i} className="flex gap-4">
                        <span className={cn("shrink-0 select-none", theme === 'modern' ? "text-zinc-700" : "text-green-800")}>{(i + 1).toString().padStart(3, '0')}</span>
                        <span className={cn(
                          theme === 'modern' ? (
                            log.includes('Error') ? 'text-rose-400' : 
                            log.includes('successfully') ? 'text-emerald-400' : 
                            'text-zinc-300'
                          ) : (
                            log.includes('Error') ? 'text-red-500 font-bold' : 
                            log.includes('successfully') ? 'text-green-300 font-bold' : 
                            'text-green-500'
                          )
                        )}>
                          {log}
                        </span>
                      </div>
                    ))}
                    {isBuilding && (
                      <div className="flex gap-4 animate-pulse">
                        <span className={cn("shrink-0", theme === 'modern' ? "text-zinc-700" : "text-green-800")}>{(logs.length + 1).toString().padStart(3, '0')}</span>
                        <span className={theme === 'modern' ? "text-sky-400" : "text-green-400"}>_</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <AnimatePresence>
            {buildStatus?.status === 'success' && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="space-y-4"
              >
                <div className="p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                      <CheckCircle2 className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h4 className="font-bold text-emerald-400">Build Successful!</h4>
                      <p className="text-sm text-emerald-500/70">
                        {buildStatus.isSimulation ? 'Simulation Complete (Mock APK)' : 'Production APK Ready'}
                      </p>
                    </div>
                  </div>
                  <a 
                    href={`/api/download/${currentBuildId}`}
                    className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
                  >
                    <Download className="w-5 h-5" />
                    Download
                  </a>
                </div>

                {buildStatus.isSimulation && (
                  <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-2">
                    <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                      <AlertCircle className="w-4 h-4" />
                      Fixing "Parsing Error" on Phone
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      The file you just downloaded is a <strong>Mock APK (49 bytes)</strong> used for testing the UI. 
                      Android cannot install this because it's not a real binary. To get a real APK:
                    </p>
                    <ol className="text-[10px] text-zinc-500 list-decimal list-inside space-y-1">
                      <li>Download this project's code.</li>
                      <li>Run it using <strong>Docker Compose</strong> on a machine with 16GB+ RAM.</li>
                      <li>The Docker build will include the 10GB Android SDK needed for real APKs.</li>
                    </ol>
                  </div>
                )}

                <div className="p-6 bg-sky-500/10 border border-sky-500/20 rounded-2xl space-y-4">
                  <div className="flex items-center gap-3">
                    <Cpu className="w-5 h-5 text-sky-500" />
                    <h4 className="font-bold text-sky-400">Direct ADB Installation</h4>
                  </div>
                  <div className="flex gap-3">
                    <input 
                      type="text" 
                      placeholder="Device ID or IP (optional)"
                      className="flex-1 px-4 py-2 bg-black/40 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/50 text-sm"
                      value={deviceId}
                      onChange={(e) => setDeviceId(e.target.value)}
                    />
                    <button 
                      onClick={installViaAdb}
                      disabled={isInstalling}
                      className={cn(
                        "px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-all",
                        isInstalling 
                          ? "bg-zinc-800 text-zinc-500" 
                          : "bg-sky-500 hover:bg-sky-400 text-white active:scale-95"
                      )}
                    >
                      {isInstalling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      {isInstalling ? 'Installing...' : 'Install via ADB'}
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500">
                    Ensure your device is connected via USB or network (`adb connect IP`). 
                    The server must have network access to the target device.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        </div>
        )}
      </main>

      <footer className="relative z-10 py-12 border-t border-white/5 text-center">
        <p className="text-zinc-500 text-sm">
          &copy; {new Date().getFullYear()} Repo2APK. Built for high-performance Android development.
        </p>
      </footer>
    </div>
  );
}
