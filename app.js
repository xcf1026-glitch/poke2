// 全域狀態
let globalZhDict = {}; // 儲存 { 1: "妙蛙種子", 2: "妙蛙草", ... }
let currentCards = [];
let playerCard = null;
let oppCard = null;

// DOM 元素
const loadingText = document.getElementById('loading-text');
const mainDrawBtn = document.getElementById('mainDrawBtn');
const phase1 = document.getElementById('phase-1');
const phase2 = document.getElementById('phase-2');
const carousel = document.getElementById('carousel');
const battleLog = document.getElementById('battle-log');

// Carousel 狀態
let currentRotation = 0;
let isDragging = false;
let startX = 0;
let previousRotation = 0;

window.onload = initGame;

// 1. 核心資料預載入 (GraphQL)
async function initGame() {
    try {
        const query = `
        query {
          pokemon_v2_pokemonspeciesname(where: {language_id: {_in: [4, 12]}, pokemon_species_id: {_lte: 1025}}) {
            pokemon_species_id
            name
          }
        }`;

        const response = await fetch('https://beta.pokeapi.co/graphql/v1beta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });

        const { data } = await response.json();
        
        // 整理進 Dict
        data.pokemon_v2_pokemonspeciesname.forEach(item => {
            // 避免覆蓋，優先取用第一筆抓到的中文
            if (!globalZhDict[item.pokemon_species_id]) {
                globalZhDict[item.pokemon_species_id] = item.name;
            }
        });

        loadingText.innerText = "圖鑑下載完成！準備就緒。";
        mainDrawBtn.disabled = false;

    } catch (error) {
        console.error("GraphQL Fetch Error:", error);
        loadingText.innerText = "下載失敗，請重新整理頁面。";
    }

    // 綁定事件
    mainDrawBtn.addEventListener('click', enterPhase1);
    document.getElementById('startBattleBtn').addEventListener('click', startBattle);
    document.getElementById('resetBtn').addEventListener('click', resetGame);
    setupCarouselEvents();
}

// 2. 抽取 5 張卡片 (處理重複屬性邏輯)
async function enterPhase1() {
    document.getElementById('loading-screen').classList.add('hidden');
    phase1.classList.remove('hidden');
    
    currentCards = [];
    let usedTypes = new Set();
    carousel.innerHTML = '<h3 style="color:white; text-align:center;">抽卡中...</h3>';

    while (currentCards.length < 5) {
        const randomId = Math.floor(Math.random() * 1025) + 1;
        
        // 避免抽到同一隻
        if (currentCards.some(c => c.id === randomId)) continue;

        try {
            const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${randomId}`);
            const data = await res.json();
            
            const pTypes = data.types.map(t => t.type.name);
            // 檢查是否屬性有重疊
            const hasOverlap = pTypes.some(t => usedTypes.has(t));

            if (!hasOverlap) {
                // 取出我們要的數值
                const baseHp = data.stats.find(s => s.stat.name === 'hp').base_stat;
                const baseAtk = data.stats.find(s => s.stat.name === 'attack').base_stat;
                
                const cardData = {
                    id: data.id,
                    engName: data.name,
                    zhName: globalZhDict[data.id] || data.name,
                    imgUrl: data.sprites.other['official-artwork'].front_default || data.sprites.front_default,
                    types: pTypes.join(' / '),
                    hp: baseHp * 3,  // HP * 3
                    maxHp: baseHp * 3,
                    attack: baseAtk
                };

                currentCards.push(cardData);
                pTypes.forEach(t => usedTypes.add(t)); // 將這隻的屬性加入禁用池
            }
        } catch (e) {
            console.error("Fetch pokemon error", e);
        }
    }

    renderCarousel();
}

// 渲染 3D 旋轉舞台
function renderCarousel() {
    carousel.innerHTML = '';
    const theta = 360 / currentCards.length; // 5張卡 = 72度

    currentCards.forEach((card, index) => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card';
        // 算出該卡片在 3D 空間的固定位置
        cardDiv.style.transform = `rotateY(${index * theta}deg) translateZ(var(--tz))`;
        
        cardDiv.innerHTML = `
            <img src="${card.imgUrl}" alt="${card.engName}">
            <h3>${card.zhName}</h3>
            <p class="eng-name">${card.engName}</p>
            <p class="types">${card.types}</p>
            <div class="stats">
                <div>HP <span>${card.hp}</span></div>
                <div>ATK <span>${card.attack}</span></div>
            </div>
            <button onclick="selectCard(${index})">選擇</button>
        `;
        carousel.appendChild(cardDiv);
    });
}

// 3D 拖曳邏輯 (跨裝置)
function setupCarouselEvents() {
    const handleStart = (clientX) => {
        isDragging = true;
        startX = clientX;
        previousRotation = currentRotation;
        carousel.style.transition = 'none'; // 拖曳時取消動畫，比較跟手
    };

    const handleMove = (clientX) => {
        if (!isDragging) return;
        const deltaX = clientX - startX;
        // 靈敏度調整
        currentRotation = previousRotation + (deltaX * 0.5);
        carousel.style.transform = `rotateY(${currentRotation}deg)`;
    };

    const handleEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        // 加上自動吸附最近卡片的邏輯
        const theta = 360 / 5;
        const closestRotation = Math.round(currentRotation / theta) * theta;
        currentRotation = closestRotation;
        
        carousel.style.transition = 'transform 0.5s ease-out';
        carousel.style.transform = `rotateY(${currentRotation}deg)`;
    };

    // 電腦滑鼠
    document.querySelector('.scene').addEventListener('mousedown', e => handleStart(e.clientX));
    window.addEventListener('mousemove', e => handleMove(e.clientX));
    window.addEventListener('mouseup', handleEnd);

    // 手機觸控
    document.querySelector('.scene').addEventListener('touchstart', e => handleStart(e.touches[0].clientX));
    window.addEventListener('touchmove', e => handleMove(e.touches[0].clientX));
    window.addEventListener('touchend', handleEnd);
}

// 3. 進入第二階段 (選擇卡牌 & 生成對手)
async function selectCard(index) {
    playerCard = JSON.parse(JSON.stringify(currentCards[index])); // 深拷貝
    
    // 隨機對手
    const randomId = Math.floor(Math.random() * 1025) + 1;
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${randomId}`);
    const data = await res.json();
    const baseHp = data.stats.find(s => s.stat.name === 'hp').base_stat;
    const baseAtk = data.stats.find(s => s.stat.name === 'attack').base_stat;

    oppCard = {
        engName: data.name,
        zhName: globalZhDict[data.id] || data.name,
        imgUrl: data.sprites.other['official-artwork'].front_default || data.sprites.front_default,
        hp: baseHp * 3,
        maxHp: baseHp * 3,
        attack: baseAtk
    };

    phase1.classList.add('hidden');
    phase2.classList.remove('hidden');
    
    renderBattleArena();
    battleLog.innerHTML = `<div class="log-msg sys">戰鬥準備就緒！</div>`;
    document.getElementById('startBattleBtn').classList.remove('hidden');
    document.getElementById('resetBtn').classList.add('hidden');
}

function renderBattleArena() {
    const createCardHTML = (card, label) => `
        <h3 style="margin-bottom:5px;">${label}</h3>
        <div class="card" style="position:static; width:180px; height:260px;">
            <img src="${card.imgUrl}" width="100">
            <h3>${card.zhName}</h3>
            <div style="width: 100%; background: #ddd; height: 10px; border-radius: 5px; margin-top:10px;">
                <div style="width: ${(card.hp/card.maxHp)*100}%; background: ${card.hp > card.maxHp*0.3 ? '#4caf50' : '#f44336'}; height: 100%; transition: width 0.3s;"></div>
            </div>
            <p>HP: ${Math.max(0, card.hp)} / ${card.maxHp}</p>
            <p>ATK: ${card.attack}</p>
        </div>
    `;

    document.getElementById('player-area').innerHTML = createCardHTML(playerCard, '【玩家】');
    document.getElementById('opp-area').innerHTML = createCardHTML(oppCard, '【對手】');
}

// 4. 回合制戰鬥邏輯
const sleep = ms => new Promise(r => setTimeout(r, ms));

function logMsg(msg, type = '') {
    const div = document.createElement('div');
    div.className = `log-msg ${type}`;
    div.innerText = msg;
    battleLog.appendChild(div);
    battleLog.scrollTop = battleLog.scrollHeight; // 自動滾動到底部
}

async function startBattle() {
    document.getElementById('startBattleBtn').classList.add('hidden');
    logMsg(`戰鬥開始！${playerCard.zhName} VS ${oppCard.zhName}`, 'sys');
    
    let turn = 1;

    while (playerCard.hp > 0 && oppCard.hp > 0) {
        await sleep(800);
        
        // 亂數浮動傷害 0.85 ~ 1.15
        let dmgVariance = 0.85 + Math.random() * 0.3;
        
        if (turn % 2 !== 0) {
            // 玩家攻擊
            let damage = Math.round(playerCard.attack * dmgVariance);
            oppCard.hp -= damage;
            logMsg(`${playerCard.zhName} 發動攻擊，造成了 ${damage} 點傷害！`);
        } else {
            // 對手攻擊
            let damage = Math.round(oppCard.attack * dmgVariance);
            playerCard.hp -= damage;
            logMsg(`${oppCard.zhName} 進行反擊，造成了 ${damage} 點傷害！`, 'damage');
        }

        renderBattleArena(); // 更新血條
        turn++;
    }

    await sleep(500);
    if (playerCard.hp <= 0) {
        logMsg(`勝負已分！${playerCard.zhName} 倒下了，你輸了...`, 'damage');
    } else {
        logMsg(`恭喜！${oppCard.zhName} 失去戰鬥能力，你贏了！`, 'sys');
    }

    document.getElementById('resetBtn').classList.remove('hidden');
}

function resetGame() {
    phase2.classList.add('hidden');
    enterPhase1(); // 回到抽卡階段
}