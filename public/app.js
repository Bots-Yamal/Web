let token =
  sessionStorage.getItem("mini_render_token");

const loginScreen =
  document.getElementById("loginScreen");

const app =
  document.getElementById("app");

const loginMessage =
  document.getElementById("loginMessage");

const deployMessage =
  document.getElementById("deployMessage");

const logsElement =
  document.getElementById("logs");

const globalStatus =
  document.getElementById("globalStatus");

const projectTitle =
  document.getElementById("projectTitle");

const projectStatus =
  document.getElementById("projectStatus");

const envList =
  document.getElementById("envList");


function showApp() {
  loginScreen.classList.add("hidden");
  app.classList.remove("hidden");

  updateStatus();
  updateEnv();
}


function showLogin() {
  loginScreen.classList.remove("hidden");
  app.classList.add("hidden");
}


async function login() {

  const password =
    document.getElementById(
      "password"
    ).value;

  if (!password) {
    loginMessage.textContent =
      "Introduce una clave.";

    return;
  }

  try {

    const response =
      await fetch(
        "/api/login",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            password
          })
        }
      );

    const data =
      await response.json();

    if (!data.success) {

      loginMessage.textContent =
        "❌ " + data.message;

      return;
    }

    token = data.token;

    sessionStorage.setItem(
      "mini_render_token",
      token
    );

    document.getElementById(
      "password"
    ).value = "";

    loginMessage.textContent = "";

    showApp();

  } catch {

    loginMessage.textContent =
      "❌ Error de conexión.";

  }
}


async function logout() {

  try {

    await api(
      "/api/logout",
      {
        method: "POST"
      }
    );

  } catch {}

  sessionStorage.removeItem(
    "mini_render_token"
  );

  token = null;

  showLogin();
}


async function api(url, options = {}) {

  options.headers = {
    ...(options.headers || {}),
    Authorization: token
  };

  const response =
    await fetch(url, options);

  if (response.status === 401) {

    sessionStorage.removeItem(
      "mini_render_token"
    );

    token = null;

    showLogin();

    throw new Error(
      "Sesión expirada."
    );
  }

  return response;
}


async function deploy() {

  const name =
    document.getElementById(
      "projectName"
    ).value;

  const file =
    document.getElementById(
      "projectFile"
    ).files[0];

  if (!name) {
    deployMessage.textContent =
      "❌ Escribe un nombre.";

    return;
  }

  if (!file) {
    deployMessage.textContent =
      "❌ Selecciona un ZIP.";

    return;
  }

  const formData =
    new FormData();

  formData.append(
    "name",
    name
  );

  formData.append(
    "project",
    file
  );

  deployMessage.textContent =
    "📦 Subiendo y construyendo...";

  try {

    const response =
      await api(
        "/api/deploy",
        {
          method: "POST",
          body: formData
        }
      );

    const data =
      await response.json();

    if (!data.success) {

      deployMessage.textContent =
        "❌ " + data.message;

      return;
    }

    deployMessage.textContent =
      "✅ " + data.message;

    updateStatus();

  } catch (error) {

    deployMessage.textContent =
      "❌ " + error.message;

  }
}


async function startProject() {

  try {

    const response =
      await api(
        "/api/start",
        {
          method: "POST"
        }
      );

    const data =
      await response.json();

    deployMessage.textContent =
      data.success
        ? "🟢 " + data.message
        : "❌ " + data.message;

    updateStatus();

  } catch (error) {

    deployMessage.textContent =
      "❌ " + error.message;

  }
}


async function stopProject() {

  try {

    const response =
      await api(
        "/api/stop",
        {
          method: "POST"
        }
      );

    const data =
      await response.json();

    deployMessage.textContent =
      data.success
        ? "⏹️ " + data.message
        : "ℹ️ " + data.message;

    updateStatus();

  } catch (error) {

    deployMessage.textContent =
      "❌ " + error.message;

  }
}


async function restartProject() {

  try {

    const response =
      await api(
        "/api/restart",
        {
          method: "POST"
        }
      );

    const data =
      await response.json();

    deployMessage.textContent =
      data.success
        ? "🔄 " + data.message
        : "❌ " + data.message;

    updateStatus();

  } catch (error) {

    deployMessage.textContent =
      "❌ " + error.message;

  }
}


async function updateStatus() {

  try {

    const response =
      await api(
        "/api/status"
      );

    const data =
      await response.json();

    projectTitle.textContent =
      data.name || "Sin proyecto";

    projectStatus.textContent =
      data.status;

    if (data.running) {

      globalStatus.textContent =
        "🟢 Running";

    } else if (
      data.status === "building"
    ) {

      globalStatus.textContent =
        "🟡 Building";

    } else if (
      data.status === "error"
    ) {

      globalStatus.textContent =
        "🔴 Error";

    } else {

      globalStatus.textContent =
        "⚪ Offline";
    }

    if (!data.logs.length) {

      logsElement.textContent =
        "No hay logs.";

    } else {

      logsElement.textContent =
        data.logs.join("\n");

      logsElement.scrollTop =
        logsElement.scrollHeight;
    }

  } catch {}

}


async function saveEnv() {

  const key =
    document.getElementById(
      "envKey"
    ).value.trim();

  const value =
    document.getElementById(
      "envValue"
    ).value;

  if (!key) {
    alert("Introduce el nombre.");
    return;
  }

  try {

    const response =
      await api(
        "/api/env",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            key,
            value
          })
        }
      );

    const data =
      await response.json();

    if (!data.success) {
      alert(data.message);
      return;
    }

    document.getElementById(
      "envKey"
    ).value = "";

    document.getElementById(
      "envValue"
    ).value = "";

    updateEnv();

    alert("Variable guardada.");

  } catch (error) {

    alert(error.message);

  }
}


async function updateEnv() {

  try {

    const response =
      await api(
        "/api/env"
      );

    const data =
      await response.json();

    envList.innerHTML = "";

    for (const key of data.variables) {

      const item =
        document.createElement("div");

      item.className =
        "envItem";

      item.innerHTML = `
        <span class="envName">
          ${escapeHtml(key)}
        </span>

        <button
          class="deleteEnv"
          onclick="deleteEnv('${escapeHtml(key)}')"
        >
          Eliminar
        </button>
      `;

      envList.appendChild(item);
    }

  } catch {}

}


async function deleteEnv(key) {

  if (!confirm(
    `¿Eliminar ${key}?`
  )) {
    return;
  }

  await api(
    "/api/env/" +
      encodeURIComponent(key),
    {
      method: "DELETE"
    }
  );

  updateEnv();
}


async function clearLogs() {

  await api(
    "/api/logs",
    {
      method: "DELETE"
    }
  );

  updateStatus();
}


function escapeHtml(text) {

  const div =
    document.createElement("div");

  div.textContent = text;

  return div.innerHTML;
}


if (token) {
  showApp();
} else {
  showLogin();
}


document
  .getElementById("password")
  .addEventListener(
    "keydown",
    event => {

      if (event.key === "Enter") {
        login();
      }

    }
  );


setInterval(
  updateStatus,
  2000
);
