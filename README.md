# Repo2APK

[![CI](https://github.com/lawalfataikola123/Repo2apk2/actions/workflows/ci.yml/badge.svg)](https://github.com/lawalfataikola123/Repo2apk2/actions)

Convert GitHub repositories into downloadable Android APK files.

GitHub: https://github.com/lawalfataikola123/Repo2apk2

## Features
- **Auto-Detection**: Automatically identifies project type (Gradle, Flutter, React Native).
- **Real-time Logs**: Watch the build process via WebSockets.
- **Secure**: Builds run in isolated environments.
- **History**: Keep track of your previous builds.

## Setup

1. **Environment Variables**:
   Copy `.env.example` to `.env` and fill in the required values.
   ```bash
   cp .env.example .env
   ```

2. **Docker Deployment**:
   ```bash
   docker-compose up -d --build
   ```

3. **Manual Installation**:
   ```bash
   npm install
   npm run build
   npm start
   ```

## API Endpoints
- `POST /api/build`: Start a new build.
- `GET /api/status/:buildId`: Get build status and logs.
- `GET /api/history`: Get build history.
- `GET /api/download/:buildId`: Download the generated APK.

## License
Apache-2.0
