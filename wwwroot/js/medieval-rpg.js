console.log('medieval-rpg.js loaded successfully');
console.log('Game constants section reached');

// Game Constants
const GAME_CONFIG = {
    GRAVITY: 0.5,
    JUMP_FORCE: -12,
    PLAYER_SPEED: 5,
    ENEMY_CHASE_SPEED: 1.2,
    ENEMY_PATROL_SPEED: 0.5,
    FRICTION: 0.9,
    ATTACK_RANGE: 60,
    MAGIC_COST: 10,
    POTION_HEAL: 30,
    PROJECTILE_LIFE: 120,
    SPAWN_DISTANCE: 200,
    AGGRO_RANGE: 100,
    ATTACK_COOLDOWN: 30,
    MAGIC_COOLDOWN: 60,
    ENEMY_ATTACK_COOLDOWN: 90,
    ENEMY_ATTACK_RANGE: 45,
    ENEMY_DAMAGE: 10,
    KNOCKBACK_FORCE: 3,
    PROJECTILE_KNOCKBACK: 4,
    // Performance settings
    TARGET_FPS: 60,
    MAX_ENEMIES: 20,
    MAX_PROJECTILES: 50,
    RENDER_DISTANCE: 800
};

// Object Pool for better performance
const ObjectPool = {
    projectiles: [],
    enemies: [],
    
    getProjectile: () => {
        return ObjectPool.projectiles.pop() || {
            x: 0, y: 0, vx: 0, vy: 0, w: 8, h: 8,
            life: 0, maxLife: GAME_CONFIG.PROJECTILE_LIFE,
            type: 'fireball'
        };
    },
    
    returnProjectile: (proj) => {
        if (ObjectPool.projectiles.length < 100) {
            ObjectPool.projectiles.push(proj);
        }
    },
    
    getEnemy: () => {
        return ObjectPool.enemies.pop() || {
            x: 0, y: 0, vx: 0, vy: 0, w: 30, h: 40,
            health: 50, maxHealth: 50, type: 'goblin',
            attackCooldown: 0, isAggro: false,
            aggroRange: GAME_CONFIG.AGGRO_RANGE
        };
    },
    
    returnEnemy: (enemy) => {
        if (ObjectPool.enemies.length < 50) {
            ObjectPool.enemies.push(enemy);
        }
    }
};

// Game State
const game = {
    canvas: null,
    ctx: null,
    player: {
        x: 100, y: 300, w: 40, h: 50,
        vx: 0, vy: 0, grounded: false,
        facing: 1, attacking: false,
        health: 100, maxHealth: 100,
        mana: 50, maxMana: 50,
        level: 1, exp: 0, expNext: 100,
        gold: 0, potions: 3,
        attackCooldown: 0, magicCooldown: 0
    },
    enemies: [],
    projectiles: [],
    platforms: [],
    castle: null,
    enemySpawnPositions: [],
    keys: {},
    touch: {},
    groundLevel: 400,
    currentLevel: 1,
    enemiesPerLevel: 5,
    enemiesKilled: 0,
    mapWidth: 2000,
    gameState: 'waiting',
    levelStarted: false,
    isTransitioning: false
};

// Utility Functions
const Utils = {
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    distance: (x1, y1, x2, y2) => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2),
    randomRange: (min, max) => Math.random() * (max - min) + min,
    sign: (x) => x > 0 ? 1 : x < 0 ? -1 : 0
};

// Physics System
const Physics = {
    applyGravity: (entity) => {
        entity.vy += GAME_CONFIG.GRAVITY;
    },
    
    updatePosition: (entity) => {
        entity.x += entity.vx;
        entity.y += entity.vy;
    },
    
    applyFriction: (entity) => {
        entity.vx *= GAME_CONFIG.FRICTION;
    },
    
    checkBounds: (entity, maxX) => {
        entity.x = Utils.clamp(entity.x, 0, maxX - entity.w);
    },
    
    checkGroundCollision: (entity, groundLevel) => {
        if (entity.y + entity.h > groundLevel) {
            entity.y = groundLevel - entity.h;
            entity.vy = 0;
            return true;
        }
        return false;
    },
    
    checkPlatformCollision: (entity, platforms) => {
        let grounded = false;
        
        platforms.forEach(platform => {
            if (entity.x + entity.w > platform.x && entity.x < platform.x + platform.w &&
                entity.y + entity.h > platform.y && entity.y < platform.y + platform.h) {
                
                // Landing on top
                if (entity.vy > 0 && entity.y + entity.h - entity.vy <= platform.y) {
                    entity.y = platform.y - entity.h;
                    entity.vy = 0;
                    grounded = true;
                }
                // Hitting from below
                else if (entity.vy < 0 && entity.y >= platform.y + platform.h) {
                    entity.y = platform.y + platform.h;
                    entity.vy = 0;
                }
                // Side collisions
                else if (entity.vx > 0 && entity.x + entity.w - entity.vx <= platform.x) {
                    entity.x = platform.x - entity.w;
                    entity.vx = 0;
                }
                else if (entity.vx < 0 && entity.x >= platform.x + platform.w) {
                    entity.x = platform.x + platform.w;
                    entity.vx = 0;
                }
            }
        });
        
        return grounded;
    }
};

// Input System
const Input = {
    setup: () => {
        const buttons = ['moveLeft', 'moveRight', 'moveUp', 'attackBtn', 'magicBtn', 'potionBtn'];
        const actions = ['left', 'right', 'up', 'attack', 'magic', 'potion'];
        
        buttons.forEach((id, i) => {
            const btn = document.getElementById(id);
            const action = actions[i];
            
            ['touchstart', 'mousedown'].forEach(event => {
                btn.addEventListener(event, e => {
                    e.preventDefault();
                    game.touch[action] = true;
                    btn.classList.add('pressed');
                });
            });
            
            ['touchend', 'mouseup', 'touchcancel', 'mouseleave'].forEach(event => {
                btn.addEventListener(event, e => {
                    e.preventDefault();
                    game.touch[action] = false;
                    btn.classList.remove('pressed');
                });
            });
        });
        
        window.addEventListener('keydown', e => {
            game.keys[e.key.toLowerCase()] = true;
            if (e.key === ' ') e.preventDefault();
        });
        
        window.addEventListener('keyup', e => {
            game.keys[e.key.toLowerCase()] = false;
        });
        
        window.addEventListener('resize', Game.resize);
        document.getElementById('startBtn').addEventListener('click', Game.startLevel);
    },
    
    handlePlayerInput: () => {
        if (game.gameState !== 'playing') return;
        
        const p = game.player;
        const left = game.keys['a'] || game.touch.left;
        const right = game.keys['d'] || game.touch.right;
        const up = game.keys['w'] || game.touch.up;
        const attack = game.keys[' '] || game.touch.attack;
        const magic = game.keys['r'] || game.touch.magic;
        const potion = game.keys['p'] || game.touch.potion;
        
        // Movement
        p.vx = left ? -GAME_CONFIG.PLAYER_SPEED : right ? GAME_CONFIG.PLAYER_SPEED : p.vx * 0.8;
        if (left) p.facing = -1;
        if (right) p.facing = 1;
        
        // Jump
        if (up && p.grounded) {
            p.vy = GAME_CONFIG.JUMP_FORCE;
            p.grounded = false;
        }
        
        // Attack
        if (attack && p.attackCooldown <= 0) {
            p.attacking = true;
            p.attackCooldown = GAME_CONFIG.ATTACK_COOLDOWN;
            Combat.playerAttack();
        }
        
        // Magic
        if (magic && p.magicCooldown <= 0 && p.mana >= GAME_CONFIG.MAGIC_COST) {
            p.mana -= GAME_CONFIG.MAGIC_COST;
            p.magicCooldown = GAME_CONFIG.MAGIC_COOLDOWN;
            Combat.castFireball();
        }
        
        // Potion
        if (potion && p.potions > 0 && p.health < p.maxHealth) {
            p.health = Math.min(p.maxHealth, p.health + GAME_CONFIG.POTION_HEAL);
            p.potions--;
            UI.update();
        }
    }
};

// Combat System
const Combat = {
    playerAttack: () => {
        const p = game.player;
        game.enemies.forEach((enemy, i) => {
            const dist = Utils.distance(enemy.x, enemy.y, p.x, p.y);
            
            if (dist < GAME_CONFIG.ATTACK_RANGE && Utils.sign(enemy.x - p.x) === p.facing) {
                const damage = 15 + (p.level * 2);
                enemy.health -= damage;
                UI.showPopup(enemy.x, enemy.y - 20, `-${damage}`, '#ff4444');
                
                enemy.vx = Utils.sign(enemy.x - p.x) * GAME_CONFIG.KNOCKBACK_FORCE;
                
                if (enemy.health <= 0) {
                    Combat.killEnemy(i);
                }
            }
        });
    },
    
    castFireball: () => {
        const p = game.player;
        game.projectiles.push({
            x: p.x + (p.facing * 20),
            y: p.y + 10,
            vx: p.facing * 8,
            vy: 0,
            damage: 25 + (p.level * 3),
            life: GAME_CONFIG.PROJECTILE_LIFE
        });
    },
    
    castIceSpell: () => {
        const p = game.player;
        // Ice spell creates multiple projectiles in a spread pattern
        for (let i = -1; i <= 1; i++) {
            game.projectiles.push({
                x: p.x + (p.facing * 20),
                y: p.y + 10,
                vx: p.facing * 6 + (i * 2),
                vy: i * 2,
                damage: 20 + (p.level * 2),
                life: GAME_CONFIG.PROJECTILE_LIFE,
                type: 'ice'
            });
        }
    },
    
    castLightning: () => {
        const p = game.player;
        // Lightning spell hits all enemies in range
        game.enemies.forEach((enemy, i) => {
            const dist = Utils.distance(enemy.x, enemy.y, p.x, p.y);
            if (dist < 150) {
                const damage = 30 + (p.level * 4);
                enemy.health -= damage;
                UI.showPopup(enemy.x, enemy.y - 20, `-${damage}`, '#ffff00');
                
                if (enemy.health <= 0) {
                    Combat.killEnemy(i);
                }
            }
        });
    },
    
    killEnemy: (index) => {
        const p = game.player;
        p.exp += 20 + (p.level * 5);
        p.gold += 5 + Math.floor(Math.random() * 10);
        
        Game.checkLevelUp();
        game.enemies.splice(index, 1);
        game.enemiesKilled++;
        
        UI.update();
    },
    
    updateProjectiles: () => {
        game.projectiles.forEach((proj, i) => {
            proj.x += proj.vx;
            proj.y += proj.vy;
            proj.life--;
            
            if (proj.life <= 0 || proj.x < 0 || proj.x > game.mapWidth) {
                game.projectiles.splice(i, 1);
                return;
            }
            
            game.enemies.forEach((enemy, j) => {
                if (proj.x < enemy.x + enemy.w && proj.x + 10 > enemy.x &&
                    proj.y < enemy.y + enemy.h && proj.y + 10 > enemy.y) {
                    enemy.health -= proj.damage;
                    UI.showPopup(enemy.x, enemy.y - 20, `-${proj.damage}`, '#ff4444');
                    
                    enemy.vx = Utils.sign(proj.vx) * GAME_CONFIG.PROJECTILE_KNOCKBACK;
                    game.projectiles.splice(i, 1);
                    
                    if (enemy.health <= 0) Combat.killEnemy(j);
                }
            });
        });
    }
};

// Enemy AI System
const EnemyAI = {
    updateEnemies: () => {
        game.enemies.forEach((enemy, index) => {
            Physics.applyGravity(enemy);
            Physics.updatePosition(enemy);
            
            // Platform collision
            let enemyGrounded = Physics.checkGroundCollision(enemy, game.groundLevel);
            if (!enemyGrounded) {
                enemyGrounded = Physics.checkPlatformCollision(enemy, game.platforms);
            }
            
            Physics.checkBounds(enemy, game.mapWidth);
            
            const distanceToPlayer = Math.abs(enemy.x - game.player.x);
            
            // Aggro check
            if (distanceToPlayer < enemy.aggroRange && Math.abs(enemy.y - game.player.y) < 100) {
                enemy.isAggro = true;
            }
            
            // AI behavior
            if (enemy.isAggro) {
                if (distanceToPlayer > 40) {
                    enemy.vx = Utils.sign(game.player.x - enemy.x) * GAME_CONFIG.ENEMY_CHASE_SPEED;
                } else {
                    enemy.vx *= 0.8;
                }
            } else {
                const distFromCenter = enemy.x - enemy.patrol.center;
                if (Math.abs(distFromCenter) > enemy.patrol.range) {
                    enemy.patrol.direction *= -1;
                }
                enemy.vx = enemy.patrol.direction * GAME_CONFIG.ENEMY_PATROL_SPEED;
            }
            
            Physics.applyFriction(enemy);
            
            // Attack player
            const dist = Utils.distance(game.player.x, game.player.y, enemy.x, enemy.y);
            if (dist < GAME_CONFIG.ENEMY_ATTACK_RANGE && enemy.attackCooldown <= 0) {
                game.player.health -= GAME_CONFIG.ENEMY_DAMAGE;
                enemy.attackCooldown = GAME_CONFIG.ENEMY_ATTACK_COOLDOWN;
                UI.showPopup(game.player.x, game.player.y - 20, '-10', '#ff4444');
                
                game.player.vx = Utils.sign(game.player.x - enemy.x) * GAME_CONFIG.KNOCKBACK_FORCE;
                
                if (game.player.health <= 0) Game.reset();
                UI.update();
            }
            
            enemy.attackCooldown = Math.max(0, enemy.attackCooldown - 1);
        });
    },
    
    spawnEnemy: (x, y) => {
        game.enemies.push({
            x, y, w: 35, h: 40, vx: 0, vy: 0,
            health: 50 + (game.currentLevel * 15),
            maxHealth: 50 + (game.currentLevel * 15),
            attackCooldown: 0,
            type: Math.random() > 0.5 ? 'goblin' : 'skeleton',
            aggroRange: GAME_CONFIG.AGGRO_RANGE,
            isAggro: false,
            patrol: {
                center: x,
                range: 50,
                direction: Math.random() > 0.5 ? 1 : -1
            }
        });
    },
    
    checkSpawning: () => {
        if (!game.levelStarted || game.gameState !== 'playing') return;
        
        const playerX = game.player.x;
        
        game.enemySpawnPositions.forEach((pos, index) => {
            if (!pos.spawned && Math.abs(playerX - pos.x) < pos.spawnDistance) {
                EnemyAI.spawnEnemy(pos.x, pos.y);
                pos.spawned = true;
            }
        });
    }
};

// Level System
const Level = {
    createPlatforms: () => {
        game.platforms = [
            { x: 400, y: game.groundLevel - 120, w: 120, h: 20, type: 'stone' },
            { x: 600, y: game.groundLevel - 180, w: 100, h: 20, type: 'stone' },
            { x: 800, y: game.groundLevel - 140, w: 140, h: 20, type: 'stone' },
            { x: 1100, y: game.groundLevel - 200, w: 120, h: 20, type: 'stone' },
            { x: 1400, y: game.groundLevel - 160, w: 100, h: 20, type: 'stone' },
            { x: 1700, y: game.groundLevel - 220, w: 150, h: 20, type: 'stone' }
        ];
    },
    
    createCastle: () => {
        game.castle = {
            x: game.mapWidth - 300,
            y: game.groundLevel - 300,
            w: 300, h: 300,
            flag: { x: game.mapWidth - 150, y: game.groundLevel - 350, w: 20, h: 30 }
        };
        console.log('Castle created at:', game.castle.x, game.castle.y, 'size:', game.castle.w, 'x', game.castle.h);
    },
    
    createSpawnPositions: () => {
        const minSpawnX = 300;
        const maxSpawnX = game.mapWidth - 400;
        const spacing = (maxSpawnX - minSpawnX) / game.enemiesPerLevel;
        
        game.enemySpawnPositions = [];
        for (let i = 0; i < game.enemiesPerLevel; i++) {
            const baseX = minSpawnX + (i * spacing);
            const variation = Utils.randomRange(-50, 50);
            const x = Utils.clamp(baseX + variation, minSpawnX, maxSpawnX);
            
            game.enemySpawnPositions.push({
                x, y: game.groundLevel - 40,
                spawned: false, spawnDistance: GAME_CONFIG.SPAWN_DISTANCE
            });
        }
    }
};

// UI System
const UI = {
    update: () => {
        const p = game.player;
        const elements = {
            level: p.level,
            dungeonLevel: game.currentLevel,
            enemiesLeft: game.enemiesPerLevel - game.enemiesKilled,
            health: Math.floor(p.health),
            mana: Math.floor(p.mana),
            exp: p.exp,
            expNext: p.expNext,
            gold: p.gold,
            potions: p.potions
        };
        
        Object.entries(elements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        });
        
        const healthFill = document.getElementById('healthFill');
        const manaFill = document.getElementById('manaFill');
        const expFill = document.getElementById('expFill');
        
        if (healthFill) healthFill.style.width = (p.health / p.maxHealth * 100) + '%';
        if (manaFill) manaFill.style.width = (p.mana / p.maxMana * 100) + '%';
        if (expFill) expFill.style.width = (p.exp / p.expNext * 100) + '%';
        
        const btn = document.getElementById('startBtn');
        if (btn) {
            btn.textContent = `Start Level ${game.currentLevel}`;
            btn.style.display = game.gameState === 'waiting' ? 'block' : 'none';
        }
    },
    
    showPopup: (x, y, text, color) => {
        const popup = document.createElement('div');
        popup.className = 'popup';
        popup.textContent = text;
        popup.style.left = (x - (game.player.x - game.canvas.width / 2)) + 'px';
        popup.style.top = y + 'px';
        popup.style.color = color;
        document.body.appendChild(popup);
        
        setTimeout(() => popup.remove(), 1000);
    }
};

// Rendering System
const Renderer = {
    render: () => {
        const ctx = game.ctx;
        const p = game.player;
        
        // Camera
        const cameraX = Utils.clamp(p.x - game.canvas.width / 2, 0, game.mapWidth - game.canvas.width);
        
        ctx.clearRect(0, 0, game.canvas.width, game.canvas.height);
        ctx.save();
        ctx.translate(-cameraX, 0);
        
        // Background
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(0, game.groundLevel, game.mapWidth, 100);
        
        // Platforms
        ctx.fillStyle = '#8B7355';
        game.platforms.forEach(platform => {
            ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
            ctx.fillStyle = '#A0522D';
            ctx.fillRect(platform.x + 5, platform.y + 5, platform.w - 10, 5);
            ctx.fillStyle = '#8B7355';
        });
        
        // Castle
        if (game.castle) {
            ctx.fillStyle = '#696969';
            ctx.fillRect(game.castle.x, game.castle.y, game.castle.w, game.castle.h);
            
            ctx.fillStyle = '#808080';
            ctx.fillRect(game.castle.x - 20, game.castle.y - 50, 40, 50);
            ctx.fillRect(game.castle.x + game.castle.w - 20, game.castle.y - 50, 40, 50);
            
            ctx.fillStyle = '#FF0000';
            ctx.fillRect(game.castle.flag.x, game.castle.flag.y, game.castle.flag.w, game.castle.flag.h);
            ctx.fillStyle = '#FFD700';
            ctx.fillRect(game.castle.flag.x + 5, game.castle.flag.y + 5, 10, 10);
            
            ctx.fillStyle = '#000000';
            ctx.fillRect(game.castle.x + 120, game.castle.y + 200, 60, 100);
            
            ctx.fillStyle = '#00FF00';
            ctx.font = 'bold 20px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('SAFE ZONE', game.castle.x + game.castle.w / 2, game.castle.y - 20);
            ctx.textAlign = 'left';
        }
        
        // Background elements
        ctx.fillStyle = '#654321';
        for (let i = 0; i < game.mapWidth; i += 200) {
            ctx.fillRect(i, game.groundLevel - 20, 20, 20);
        }
        
        // Spawn indicators
        if (game.gameState === 'playing') {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.2)';
            game.enemySpawnPositions.forEach(pos => {
                if (!pos.spawned) {
                    ctx.fillRect(pos.x - 15, pos.y - 5, 30, 5);
                }
            });
        }
        
        // Player
        ctx.fillStyle = p.attacking ? '#4169E1' : '#4682B4';
        ctx.fillRect(p.x, p.y, p.w, p.h);
        
        ctx.fillStyle = '#FFE4B5';
        ctx.fillRect(p.x + 8, p.y + 8, 24, 20);
        
        if (p.attacking) {
            ctx.fillStyle = '#C0C0C0';
            ctx.fillRect(p.x + (p.facing > 0 ? 35 : -15), p.y + 15, 15, 3);
        }
        
        // Enemies
        game.enemies.forEach(enemy => {
            ctx.fillStyle = enemy.type === 'goblin' ? '#228B22' : '#D2691E';
            ctx.fillRect(enemy.x, enemy.y, enemy.w, enemy.h);
            
            ctx.fillStyle = enemy.isAggro ? '#ff0000' : '#000000';
            ctx.fillRect(enemy.x + 8, enemy.y + 8, 4, 4);
            ctx.fillRect(enemy.x + 20, enemy.y + 8, 4, 4);
            
            if (enemy.isAggro) {
                ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
                ctx.fillRect(enemy.x - 2, enemy.y - 2, enemy.w + 4, enemy.h + 4);
            }
            
            const healthPercent = enemy.health / enemy.maxHealth;
            ctx.fillStyle = '#ff4444';
            ctx.fillRect(enemy.x, enemy.y - 10, enemy.w * healthPercent, 4);
            ctx.fillStyle = '#333';
            ctx.fillRect(enemy.x + (enemy.w * healthPercent), enemy.y - 10, enemy.w * (1 - healthPercent), 4);
        });
        
        // Projectiles
        ctx.fillStyle = '#FF4500';
        game.projectiles.forEach(proj => {
            ctx.fillRect(proj.x, proj.y, 10, 6);
            ctx.fillStyle = '#FF6500';
            ctx.fillRect(proj.x - 5, proj.y + 1, 5, 4);
            ctx.fillStyle = '#FF4500';
        });
        
        ctx.restore();
    }
};

// Main Game Controller
const Game = {
    init: () => {
        console.log('Game.init() called');
        game.canvas = document.getElementById('gameCanvas');
        game.ctx = game.canvas.getContext('2d');
        console.log('Canvas found:', game.canvas ? 'yes' : 'no');
        Game.resize();
        Input.setup();
        UI.update();
        Game.loop();
        console.log('Game initialization complete');
    },
    
    resize: () => {
        game.canvas.width = window.innerWidth;
        const isMobile = window.innerWidth < 768;
        game.canvas.height = isMobile ? window.innerHeight - 200 : window.innerHeight;
        game.groundLevel = game.canvas.height - 100;
    },
    
    startLevel: () => {
        console.log('startLevel() called. gameState:', game.gameState);
        // Allow starting from 'levelComplete' state for auto-progression
        if (game.gameState !== 'waiting' && game.gameState !== 'levelComplete') {
            console.log('startLevel blocked - invalid gameState:', game.gameState);
            return;
        }
        
        console.log('Starting level...');
        // Reset player to starting position
        Object.assign(game.player, {
            x: 100, y: 300, vx: 0, vy: 0, grounded: false, facing: 1
        });
        
        game.gameState = 'playing';
        game.levelStarted = true;
        game.enemiesKilled = 0;
        console.log('Game state set to playing');
        
        Level.createPlatforms();
        Level.createCastle();
        Level.createSpawnPositions();
        console.log('Level elements created');
        
        UI.update();
        console.log('startLevel complete!');
    },
    
    update: () => {
        const p = game.player;
        
        // Always run basic player physics
        Physics.applyGravity(p);
        Physics.updatePosition(p);
        Physics.checkBounds(p, game.mapWidth);
        
        p.grounded = Physics.checkGroundCollision(p, game.groundLevel);
        if (!p.grounded) {
            p.grounded = Physics.checkPlatformCollision(p, game.platforms);
        }
        
        // Only run game logic when playing
        if (game.gameState !== 'playing') return;
        
        EnemyAI.checkSpawning();
        
        // Enemy updates
        EnemyAI.updateEnemies();
        
        // Projectile updates
        Combat.updateProjectiles();
        
        // Castle collision
        if (game.castle && p.x + p.w > game.castle.x && p.x < game.castle.x + game.castle.w &&
            p.y + p.h > game.castle.y && p.y < game.castle.y + game.castle.h && game.gameState === 'playing') {
            console.log('Castle collision detected! Triggering next level...');
            console.log('Player position:', p.x, p.y, 'Castle position:', game.castle.x, game.castle.y);
            console.log('Game state before collision:', game.gameState);
            game.gameState = 'levelComplete';
            UI.showPopup(p.x, p.y - 50, 'VICTORY!', '#00ff00');
            setTimeout(() => {
                console.log('Calling Game.nextLevel()...');
                Game.nextLevel();
            }, 2000);
        }
        
        // Cooldowns and regen
        p.attackCooldown = Math.max(0, p.attackCooldown - 1);
        p.magicCooldown = Math.max(0, p.magicCooldown - 1);
        p.attacking = p.attackCooldown > 20;
        p.mana = Math.min(p.maxMana, p.mana + 0.1);
    },
    
    nextLevel: () => {
        console.log('nextLevel() called. isTransitioning:', game.isTransitioning);
        // Prevent multiple calls by checking if we're already processing a level transition
        if (game.isTransitioning) {
            console.log('Already transitioning, returning...');
            return;
        }
        
        console.log('Starting level transition...');
        game.isTransitioning = true;
        game.gameState = 'levelComplete';
        UI.showPopup(game.canvas.width/2, game.canvas.height/2, `Level ${game.currentLevel} Complete!`, '#00ff00');
        
        setTimeout(() => {
            console.log('nextLevel setTimeout callback executing...');
            game.currentLevel++;
            console.log('Current level incremented to:', game.currentLevel);
            
            // Check if player has reached the final level (100)
            if (game.currentLevel > 100) {
                console.log('Reached final level!');
                UI.showPopup(game.canvas.width/2, game.canvas.height/2, '🎉 CONGRATULATIONS! You have completed all 100 levels! 🎉', '#ffaa00');
                setTimeout(() => {
                    UI.showPopup(game.canvas.width/2, game.canvas.height/2, 'You are the ultimate champion!', '#00ff00');
                }, 3000);
                game.isTransitioning = false;
                return;
            }
            
            game.enemiesPerLevel = Math.min(10, 5 + Math.floor(game.currentLevel / 2));
            console.log('Enemies per level set to:', game.enemiesPerLevel);
            UI.showPopup(game.canvas.width/2, game.canvas.height/2, `Dungeon Level ${game.currentLevel}`, '#ffaa00');
            
            // Reset player
            Object.assign(game.player, {
                x: 100, y: 300, vx: 0, vy: 0, grounded: false, facing: 1
            });
            console.log('Player reset to starting position');
            
            // Clear level data
            game.enemies = [];
            game.projectiles = [];
            game.enemySpawnPositions = [];
            game.platforms = [];
            game.castle = null;
            game.levelStarted = false;
            game.isTransitioning = false;
            console.log('Level data cleared');
            
            // Automatically start the next level
            console.log('Calling Game.startLevel()...');
            Game.startLevel();
            
            UI.update();
            console.log('Level transition complete!');
        }, 2000);
    },
    
    checkLevelUp: () => {
        const p = game.player;
        if (p.exp >= p.expNext) {
            p.level++;
            p.exp -= p.expNext;
            p.expNext = Math.floor(p.expNext * 1.5);
            p.maxHealth += 20;
            p.health = p.maxHealth;
            p.maxMana += 10;
            p.mana = p.maxMana;
            p.potions += 2;
            
            UI.showPopup(game.canvas.width/2, game.canvas.height/2, `LEVEL UP! Level ${p.level}`, '#ffaa00');
            UI.update();
        }
    },
    
    reset: () => {
        UI.showPopup(game.canvas.width/2, game.canvas.height/2, 'YOU DIED! Game Reset...', '#ff4444');
        
        setTimeout(() => {
            Object.assign(game.player, {
                x: 100, y: 300, vx: 0, vy: 0, grounded: false, facing: 1,
                health: 100, maxHealth: 100, mana: 50, maxMana: 50,
                level: 1, exp: 0, expNext: 100, gold: 0, potions: 3,
                attackCooldown: 0, magicCooldown: 0, attacking: false
            });
            
            game.currentLevel = 1;
            game.enemiesPerLevel = 5;
            game.enemiesKilled = 0;
            game.enemies = [];
            game.projectiles = [];
            game.enemySpawnPositions = [];
            game.platforms = [];
            game.castle = null;
            game.touch = {};
            game.gameState = 'waiting';
            game.levelStarted = false;
            
            UI.update();
        }, 2000);
    },
    
    loop: () => {
        const now = performance.now();
        if (!Game.lastFrameTime) {
            Game.lastFrameTime = now;
            console.log('Game loop started');
        }
        
        const deltaTime = now - Game.lastFrameTime;
        const targetFrameTime = 1000 / GAME_CONFIG.TARGET_FPS;
        
        if (deltaTime >= targetFrameTime) {
            Game.lastFrameTime = now - (deltaTime % targetFrameTime);
            
            Input.handlePlayerInput();
            Game.update();
            Renderer.render();
        }
        
        requestAnimationFrame(Game.loop);
    }
};

// Initialize game
function initMedievalRPG() {
    console.log('initMedievalRPG() called from Blazor');
    try {
        Game.init();
        console.log('Game.init() completed successfully');
    } catch (error) {
        console.error('Error in initMedievalRPG:', error);
    }
}

// Inventory System
const Inventory = {
    currentWeapon: { name: "Rusty Sword", damage: 5 },
    currentArmor: { name: "Leather Armor", defense: 3 },
    
    showInventory: () => {
        console.log("Inventory opened");
    },
    
    hideInventory: () => {
        console.log("Inventory closed");
    },
    
    equipWeapon: (name, damage) => {
        Inventory.currentWeapon = { name, damage };
        if (game && game.canvas) {
            UI.showPopup(game.canvas.width/2, game.canvas.height/2, `Equipped: ${name}`, '#ffaa00');
        }
        console.log(`Equipped weapon: ${name} (Damage: ${damage})`);
    },
    
    equipArmor: (name, defense) => {
        Inventory.currentArmor = { name, defense };
        if (game && game.canvas) {
            UI.showPopup(game.canvas.width/2, game.canvas.height/2, `Equipped: ${name}`, '#ffaa00');
        }
        console.log(`Equipped armor: ${name} (Defense: ${defense})`);
    },
    
    useItem: (name, effect) => {
        const p = game.player;
        
        if (name.includes("Health Potion")) {
            p.health = Math.min(p.maxHealth, p.health + 50);
            if (game && game.canvas) {
                UI.showPopup(game.canvas.width/2, game.canvas.height/2, "Health restored!", '#00ff00');
            }
        } else if (name.includes("Mana Potion")) {
            p.mana = Math.min(p.maxMana, p.mana + 30);
            if (game && game.canvas) {
                UI.showPopup(game.canvas.width/2, game.canvas.height/2, "Mana restored!", '#0088ff');
            }
        } else if (name.includes("Strength Potion")) {
            if (game && game.canvas) {
                UI.showPopup(game.canvas.width/2, game.canvas.height/2, "Strength boosted!", '#ffaa00');
            }
        }
        
        if (game && game.player) {
            UI.update();
        }
        console.log(`Used item: ${name} - ${effect}`);
    },
    
    useMagicItem: (name, description) => {
        if (name.includes("Fire Scroll")) {
            Combat.castFireball();
        } else if (name.includes("Ice Scroll")) {
            Combat.castIceSpell();
        } else if (name.includes("Lightning Scroll")) {
            Combat.castLightning();
        }
        
        if (game && game.canvas) {
            UI.showPopup(game.canvas.width/2, game.canvas.height/2, `Used: ${name}`, '#ffaa00');
        }
        console.log(`Used magic item: ${name} - ${description}`);
    }
};

// Make inventory functions globally available
window.showInventory = Inventory.showInventory;
window.hideInventory = Inventory.hideInventory;
window.equipWeapon = Inventory.equipWeapon;
window.equipArmor = Inventory.equipArmor;
window.useItem = Inventory.useItem;
window.useMagicItem = Inventory.useMagicItem;
window.showPopup = (message, color) => {
    if (game && game.canvas) {
        UI.showPopup(game.canvas.width/2, game.canvas.height/2, message, color);
    } else {
        // Fallback if game isn't initialized yet
        console.log(`Popup: ${message}`);
    }
};
window.startLevel = () => {
    Game.startLevel();
};
window.initMedievalRPG = () => {
    console.log('window.initMedievalRPG() called');
    try {
        Game.init();
        console.log('Game.init() completed successfully from window function');
    } catch (error) {
        console.error('Error in window.initMedievalRPG:', error);
    }
};

console.log('medieval-rpg.js file completely loaded'); 