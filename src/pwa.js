const button = document.querySelector("#install-button");
const status = document.querySelector("#install-status");
let installPrompt;
let isInstalled = false;

function message(text) {
  status.textContent = text;
  status.hidden = !text;
}

function installed() {
  installPrompt = null;
  isInstalled = true;
  button.disabled = true;
  message("");
}
const standalone = window.matchMedia("(display-mode: standalone)");
if (standalone.matches || navigator.standalone) installed();
standalone.addEventListener("change", (event) => { if (event.matches) installed(); });
window.addEventListener("appinstalled", installed);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  if (standalone.matches || navigator.standalone) return;
  installPrompt = event;
  button.disabled = false;
  message("");
});
button.addEventListener("click", async () => {
  if (!installPrompt) {
    message("Chrome 메뉴에서 앱 설치를 선택하세요.");
    return;
  }
  const prompt = installPrompt;
  installPrompt = null;
  button.disabled = true;
  try {
    await prompt.prompt();
    await prompt.userChoice;
    message("");
  } catch { message("설치 실패. 다시 시도해 주세요."); }
  finally { button.disabled = isInstalled; }
});

export const workerReady = "serviceWorker" in navigator && window.isSecureContext
  ? navigator.serviceWorker.register(new URL("./sw.js", document.baseURI), { scope: new URL("./", document.baseURI).pathname, updateViaCache: "none" }).then(() => navigator.serviceWorker.ready)
  : Promise.resolve(null);
// Keep registration failure handled even before the admin logs in.
workerReady.catch(() => { message("앱 준비 실패. 새로고침해 주세요."); });
