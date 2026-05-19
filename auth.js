// login.html script — handles signup/login forms and stores JWTs.

const toastEl = document.getElementById("toast");
let toastTimer;
function toast(message, type = "") {
    toastEl.textContent = message;
    toastEl.className = `toast ${type}`;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

// Flash message handed off from play.html (e.g. session expired)
const flash = popFlash();
if (flash) toast(flash, "error");

// If already signed in (and token still valid), skip straight to game.
(async function bootstrap() {
    if (!isAuthed()) return;
    try {
        const res = await authedFetch("/auth/me");
        if (res.ok) window.location.replace("play.html");
    } catch (_) {
        clearTokens();
    }
})();

const tabs = document.querySelectorAll(".auth-tab");
const forms = {
    login: document.getElementById("loginForm"),
    signup: document.getElementById("signupForm"),
};

tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        tabs.forEach((t) => t.classList.toggle("active", t === tab));
        Object.entries(forms).forEach(([name, form]) => {
            form.hidden = name !== target;
        });
        const firstInput = forms[target].querySelector("input");
        if (firstInput) firstInput.focus();
    });
});

forms.signup.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(forms.signup);
    const email = fd.get("email").trim();
    const password = fd.get("password");
    const password2 = fd.get("password2");

    if (password !== password2) {
        toast("비밀번호가 일치하지 않습니다", "error");
        return;
    }

    try {
        toast("회원가입 요청 중... (Render 콜드스타트 시 30초 대기)", "");
        const res = await publicFetch("/auth/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });
        if (!res.ok) {
            toast(`회원가입 실패: ${await readError(res)}`, "error");
            return;
        }
        toast("회원가입 성공! 자동 로그인합니다.", "success");
        await doLogin(email, password);
    } catch (err) {
        toast(`네트워크 오류: ${err.message}`, "error");
    }
});

forms.login.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(forms.login);
    await doLogin(fd.get("email").trim(), fd.get("password"));
});

async function doLogin(email, password) {
    // /auth/login expects OAuth2 form-encoded body (username=email)
    const body = new URLSearchParams({ username: email, password });
    try {
        toast("로그인 중...", "");
        const res = await publicFetch("/auth/login", { method: "POST", body });
        if (!res.ok) {
            toast(`로그인 실패: ${await readError(res)}`, "error");
            return;
        }
        const data = await res.json();
        saveTokens(data, email);
        window.location.href = "play.html";
    } catch (err) {
        toast(`네트워크 오류: ${err.message}`, "error");
    }
}
