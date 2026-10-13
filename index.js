const express = require("express");
const multer = require("multer");
const AdmZip = require("adm-zip");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();

const PORT = process.env.PORT || 3000;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;

if (!PANEL_PASSWORD) {
  console.error("ERROR: Falta la variable PANEL_PASSWORD.");
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, "projects");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessions = new Set();

const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: 100 * 1024 * 1024
  }
});

const project = {
  name: null,
  directory: null,
  process: null,
  status: "offline",
  logs: [],
  environment: {}
};

function log(message) {
  const line =
    `[${new Date().toLocaleTimeString()}] ${message}`;

  project.logs.push(line);

  if (project.logs.length > 500) {
    project.logs.shift();
  }

  console.log(line);
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization;

  if (!token || !sessions.has(token)) {
    return res.status(401).json({
      success: false,
      message: "No autorizado."
    });
  }

  next();
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function safeProjectName(name) {
  return String(name || "project")
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .slice(0, 40);
}

function cleanProjectDirectory() {
  if (project.directory &&
      fs.existsSync(project.directory)) {
    fs.rmSync(project.directory, {
      recursive: true,
      force: true
    });
  }
}

function stopProject() {
  if (!project.process) {
    project.status = "offline";
    return;
  }

  log("Deteniendo proyecto...");

  project.process.kill("SIGTERM");

  project.process = null;
  project.status = "offline";
}

function getStartCommand(directory) {
  const packagePath =
    path.join(directory, "package.json");

  if (!fs.existsSync(packagePath)) {
    return "node index.js";
  }

  try {
    const pkg = JSON.parse(
      fs.readFileSync(packagePath, "utf8")
    );

    if (pkg.scripts && pkg.scripts.start) {
      return pkg.scripts.start;
    }

    if (pkg.main) {
      return `node ${pkg.main}`;
    }

  } catch (error) {
    log("No se pudo leer package.json.");
  }

  return "node index.js";
}

function startProject() {
  if (!project.directory) {
    throw new Error("No hay ningún proyecto.");
  }

  if (project.process) {
    throw new Error("El proyecto ya está ejecutándose.");
  }

  const command =
    getStartCommand(project.directory);

  log(`Ejecutando: ${command}`);

  const child = spawn(command, {
    cwd: project.directory,
    shell: true,
    env: {
      ...process.env,
      ...project.environment
    }
  });

  project.process = child;
  project.status = "running";

  child.stdout.on("data", data => {
    const text = data.toString().trim();

    if (text) {
      log(text);
    }
  });

  child.stderr.on("data", data => {
    const text = data.toString().trim();

    if (text) {
      log(text);
    }
  });

  child.on("error", error => {
    log(`Error del proceso: ${error.message}`);
  });

  child.on("close", code => {
    project.process = null;

    if (project.status !== "stopping") {
      log(`Proceso detenido. Código: ${code}`);
    }

    project.status = "offline";
  });
}

async function installDependencies(directory) {
  return new Promise((resolve, reject) => {
    log("Ejecutando npm install...");

    const child = spawn("npm", ["install"], {
      cwd: directory,
      shell: true,
      env: {
        ...process.env,
        ...project.environment
      }
    });

    child.stdout.on("data", data => {
      const text = data.toString().trim();

      if (text) {
        log(text);
      }
    });

    child.stderr.on("data", data => {
      const text = data.toString().trim();

      if (text) {
        log(text);
      }
    });

    child.on("error", reject);

    child.on("close", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `npm install terminó con código ${code}`
          )
        );
      }
    });
  });
}

/* =========================
   AUTENTICACIÓN
========================= */

app.post("/api/login", (req, res) => {
  const password = req.body.password;

  if (
    typeof password !== "string" ||
    password !== PANEL_PASSWORD
  ) {
    return res.status(401).json({
      success: false,
      message: "Clave incorrecta."
    });
  }

  const token = createToken();

  sessions.add(token);

  res.json({
    success: true,
    token
  });
});

app.post(
  "/api/logout",
  requireAuth,
  (req, res) => {

    const token = req.headers.authorization;

    sessions.delete(token);

    res.json({
      success: true
    });
  }
);

/* =========================
   STATUS
========================= */

app.get(
  "/api/status",
  requireAuth,
  (req, res) => {

    res.json({
      name: project.name,
      status: project.status,
      running: !!project.process,
      logs: project.logs
    });
  }
);

/* =========================
   DEPLOY
========================= */

app.post(
  "/api/deploy",
  requireAuth,
  upload.single("project"),
  async (req, res) => {

    try {

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No se recibió ningún ZIP."
        });
      }

      if (
        !req.file.originalname
          .toLowerCase()
          .endsWith(".zip")
      ) {
        fs.rmSync(req.file.path, {
          force: true
        });

        return res.status(400).json({
          success: false,
          message: "El proyecto debe ser un archivo .zip."
        });
      }

      stopProject();
      cleanProjectDirectory();

      const name =
        safeProjectName(req.body.name);

      const directory =
        path.join(DATA_DIR, name);

      fs.mkdirSync(directory, {
        recursive: true
      });

      log(`Desplegando "${name}"...`);

      const zip = new AdmZip(req.file.path);

      zip.extractAllTo(
        directory,
        true
      );

      fs.rmSync(req.file.path, {
        force: true
      });

      /*
       * Si el ZIP contiene una carpeta raíz,
       * buscamos package.json dentro de ella.
       */

      let realDirectory = directory;

      function findPackageFolder(folder) {
        const packageFile =
          path.join(folder, "package.json");

        if (fs.existsSync(packageFile)) {
          return folder;
        }

        const entries =
          fs.readdirSync(folder, {
            withFileTypes: true
          });

        for (const entry of entries) {
          if (!entry.isDirectory()) {
            continue;
          }

          const candidate =
            path.join(folder, entry.name);

          const result =
            findPackageFolder(candidate);

          if (result) {
            return result;
          }
        }

        return null;
      }

      const found =
        findPackageFolder(directory);

      if (found) {
        realDirectory = found;
      }

      project.name = name;
      project.directory = realDirectory;
      project.logs = [];
      project.status = "building";

      log("Proyecto extraído correctamente.");

      const packagePath =
        path.join(
          realDirectory,
          "package.json"
        );

      if (!fs.existsSync(packagePath)) {
        project.status = "error";

        return res.status(400).json({
          success: false,
          message:
            "El ZIP debe contener package.json."
        });
      }

      await installDependencies(
        realDirectory
      );

      project.status = "ready";

      log("Build completado correctamente.");

      res.json({
        success: true,
        message: "Deploy completado.",
        name,
        status: project.status
      });

    } catch (error) {

      project.status = "error";

      log(`ERROR: ${error.message}`);

      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

/* =========================
   START
========================= */

app.post(
  "/api/start",
  requireAuth,
  (req, res) => {

    try {

      startProject();

      res.json({
        success: true,
        message: "Proyecto iniciado."
      });

    } catch (error) {

      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
);

/* =========================
   STOP
========================= */

app.post(
  "/api/stop",
  requireAuth,
  (req, res) => {

    if (!project.process) {
      return res.json({
        success: false,
        message: "El proyecto ya está detenido."
      });
    }

    project.status = "stopping";

    stopProject();

    res.json({
      success: true,
      message: "Proyecto detenido."
    });
  }
);

/* =========================
   RESTART
========================= */

app.post(
  "/api/restart",
  requireAuth,
  (req, res) => {

    try {

      stopProject();

      setTimeout(() => {

        try {
          startProject();
        } catch (error) {
          log(`ERROR: ${error.message}`);
        }

      }, 1000);

      res.json({
        success: true,
        message: "Reiniciando..."
      });

    } catch (error) {

      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
);

/* =========================
   VARIABLES
========================= */

app.get(
  "/api/env",
  requireAuth,
  (req, res) => {

    res.json({
      variables: Object.keys(
        project.environment
      )
    });
  }
);

app.post(
  "/api/env",
  requireAuth,
  (req, res) => {

    const {
      key,
      value
    } = req.body;

    if (
      typeof key !== "string" ||
      !/^[A-Z_][A-Z0-9_]*$/i.test(key)
    ) {
      return res.status(400).json({
        success: false,
        message: "Nombre de variable inválido."
      });
    }

    project.environment[key] =
      String(value ?? "");

    res.json({
      success: true,
      message: `Variable ${key} guardada.`
    });
  }
);

app.delete(
  "/api/env/:key",
  requireAuth,
  (req, res) => {

    delete project.environment[
      req.params.key
    ];

    res.json({
      success: true
    });
  }
);

/* =========================
   LOGS
========================= */

app.delete(
  "/api/logs",
  requireAuth,
  (req, res) => {

    project.logs = [];

    res.json({
      success: true
    });
  }
);

/* =========================
   WEB
========================= */

app.get("*", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Mini Render iniciado en puerto ${PORT}`
    );

  }
);
