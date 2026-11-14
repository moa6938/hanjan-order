const button = document.querySelector("#install-button");
const status = document.querySelector("#install-status");
let installPrompt;

function installed() {
  installPrompt = null;
  button.hidden = true;
  status.textContent = "앱 모드로 사용 중입니다. 아래에서 푸시 알림을 설정하세요.";
}
const standalone = window.matchMedia("(display-mode: standalone)");
if (standalone.matches || navigator.standalone) installed();
standalone.addEventListener("change", (event) => { if (event.matches) installed(); });
window.addEventListener("appinstalled", installed);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  if (standalone.matches || navigator.standalone) return;
  installPrompt = event;
  button.hidden = false;
  status.textContent = "‘앱 설치’를 눌러 홈 화면에 주문 관리 아이콘을 추가하세요.";
});
button.addEventListener("click", async () => {
  if (!installPrompt) {
    status.textContent = "Chrome 메뉴(⋮)에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택하세요.";
    return;
  }
  const prompt = installPrompt;
  installPrompt = null;
  button.disabled = true;
  try {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    status.textContent = outcome === "accepted" ? "설치를 요청했어요. 홈 화면 아이콘으로 열어주세요." : "설치를 취소했어요. Chrome 메뉴에서 다시 설치할 수 있어요.";
  } catch { status.textContent = "설치 창을 열지 못했어요. Chrome 메뉴에서 앱을 설치하세요."; }
  finally { button.disabled = false; }
});

export const workerReady = "serviceWorker" in navigator && window.isSecureContext
  ? navigator.serviceWorker.register(new URL("./sw.js", document.baseURI), { scope: new URL("./", document.baseURI).pathname, updateViaCache: "none" }).then(() => navigator.serviceWorker.ready)
  : Promise.resolve(null);
// Keep registration failure handled even before the admin logs in.
workerReady.catch(() => { status.textContent = "앱 준비에 실패했어요. 연결을 확인한 뒤 새로고침해 주세요."; });
