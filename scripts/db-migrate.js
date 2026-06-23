const net = require('net');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env if present
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.\-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      // Remove surrounding quotes
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  });
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("Error: DATABASE_URL environment variable is not defined.");
  process.exit(1);
}

// Parse host and port from postgresql URL
// Format: postgresql://username:password@host:port/database
const matches = dbUrl.match(/@([^/:]+)(?::(\d+))?/);
const host = matches ? matches[1] : 'localhost';
const port = matches && matches[2] ? parseInt(matches[2], 10) : 5432;

function checkConnection(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isResolved = false;

    socket.connect(port, host, () => {
      socket.destroy();
      if (!isResolved) {
        isResolved = true;
        resolve(true);
      }
    });

    socket.on('error', () => {
      socket.destroy();
      if (!isResolved) {
        isResolved = true;
        resolve(false);
      }
    });

    socket.setTimeout(timeout);
    socket.on('timeout', () => {
      socket.destroy();
      if (!isResolved) {
        isResolved = true;
        resolve(false);
      }
    });
  });
}

async function main() {
  console.log(`Checking connection to database at ${host}:${port}...`);
  let connected = await checkConnection(host, port);

  if (!connected) {
    console.log("Database port is closed. Attempting to start database via docker compose...");
    try {
      execSync('docker compose up -d db', { stdio: 'inherit' });
      console.log("Waiting for database port to become available...");
      // Try multiple times to connect
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        connected = await checkConnection(host, port);
        if (connected) break;
      }
    } catch (e) {
      console.log("Could not start docker compose or docker is not installed.");
    }
  }

  if (connected) {
    console.log("Database is online. Running migrations...");
    try {
      execSync('npx prisma migrate dev --name init', { stdio: 'inherit' });
      console.log("Migrations applied successfully.");
    } catch (e) {
      console.error("Migration failed:", e.message);
      process.exit(1);
    }
  } else {
    console.warn("\n======================================================================");
    console.warn("WARNING: Database is offline and could not be started automatically.");
    console.warn("Please make sure Docker is running or PostgreSQL is started.");
    console.warn("Skipping migration for now to allow setup script to finish.");
    console.warn("======================================================================\n");
    process.exit(0); // Exit with 0 to prevent setup from failing
  }
}

main();
