import { supabase } from './supabase.js';

/* ===========================
   Configuration
   =========================== */
let SECRET_PASSWORD = localStorage.getItem('calc_password') || '500';
let USER_A_KEY = localStorage.getItem('user_a_password') || '423';

// Sync passwords from Supabase on load
async function syncPasswords() {
    try {
        // Fetch latest calculator password
        const { data: calcData } = await supabase
            .from('messages')
            .select('content')
            .eq('type', 'calculator_password')
            .order('created_at', { ascending: false })
            .limit(1);

        if (calcData && calcData.length > 0) {
            SECRET_PASSWORD = calcData[0].content;
            localStorage.setItem('calc_password', SECRET_PASSWORD);
        }

        // Fetch latest User A password
        const { data: aData } = await supabase
            .from('messages')
            .select('content')
            .eq('type', 'user_a_password')
            .order('created_at', { ascending: false })
            .limit(1);

        if (aData && aData.length > 0) {
            USER_A_KEY = aData[0].content;
            localStorage.setItem('user_a_password', USER_A_KEY);
        }
    } catch (e) {
        console.error("Password sync failed:", e);
    }
}

// REAL-TIME CLOUD SYNC: Listen for password changes while the app is open
function setupPasswordSubscription() {
    supabase.channel('password_sync')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
            if (payload.new.type === 'calculator_password') {
                SECRET_PASSWORD = payload.new.content;
                localStorage.setItem('calc_password', SECRET_PASSWORD);
                console.log("☁️ Calculator password updated via cloud");
            } else if (payload.new.type === 'user_a_password') {
                USER_A_KEY = payload.new.content;
                localStorage.setItem('user_a_password', USER_A_KEY);
                console.log("☁️ User A password updated via cloud");
            }
        })
        .subscribe();
}

let syncPromise = syncPasswords();
setupPasswordSubscription();

let calcValue = '0';
let waitingForNext = false;
let firstOperand = null;
let operator = null;

const display = document.getElementById('calc-display');
const calcView = document.getElementById('calculator-view');
const identityView = document.getElementById('identity-view');

window.calcAction = function (val) {
    if (val === 'AC') {
        calcValue = '0'; firstOperand = null; operator = null; waitingForNext = false;
    } else if (val === 'backspace') {
        calcValue = calcValue.length > 1 ? calcValue.slice(0, -1) : '0';
    } else if (['+', '-', '*', '/'].includes(val)) {
        firstOperand = parseFloat(calcValue);
        operator = val;
        waitingForNext = true;
    } else if (val === '.') {
        if (!calcValue.includes('.')) calcValue += '.';
    } else {
        if (waitingForNext) { calcValue = val; waitingForNext = false; }
        else { calcValue = calcValue === '0' ? val : calcValue + val; }
    }
    updateDisplay();
};

function updateDisplay() { display.innerText = calcValue; }

window.tryUnlock = async function () {
    if (operator && firstOperand !== null) {
        const second = parseFloat(calcValue);
        let res = 0;
        if (operator === '+') res = firstOperand + second;
        if (operator === '-') res = firstOperand - second;
        if (operator === '*') res = firstOperand * second;
        if (operator === '/') res = firstOperand / second;
        calcValue = String(res);
        operator = null; firstOperand = null;
        updateDisplay();
    }

    try { await syncPromise; } catch (e) { }

    if (calcValue === SECRET_PASSWORD) unlockApp();
};

function unlockApp() {
    calcView.style.opacity = '0';
    setTimeout(() => {
        calcView.style.display = 'none';
        identityView.style.display = 'flex';
        identityView.style.opacity = '0';
        setTimeout(() => {
            identityView.style.transition = 'opacity 0.6s ease';
            identityView.style.opacity = '1';
        }, 50);
    }, 400);
}

const userAPassView = document.getElementById('user-a-pass-view');
const userAPassInput = document.getElementById('user-a-pass-input');

window.selectUser = function (u) {
    if (u === 'A') {
        identityView.style.display = 'none';
        userAPassView.style.display = 'flex';
        userAPassInput.focus();
    } else {
        sessionStorage.setItem('chat_user', u);
        window.location.href = 'chat.html';
    }
};

window.verifyUserAPass = async function () {
    try { await syncPromise; } catch (e) { }
    if (userAPassInput.value === USER_A_KEY) {
        sessionStorage.setItem('chat_user', 'A');
        window.location.href = 'chat.html';
    } else {
        alert("Wrong password!");
        userAPassInput.value = '';
    }
};

window.closeUserAPass = function () {
    userAPassView.style.display = 'none';
    identityView.style.display = 'flex';
    userAPassInput.value = '';
};
