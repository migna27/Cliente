/* 
   ------------------------------------------------
    maneja la lógica del lado del cliente (Navegador).
   Se comunica con 'cliente_http.py' usando fetch().
*/

let pollingInterval = null;

// ==========================================
// 1. GESTIÓN DE CONEXIÓN
// ==========================================

async function conectar() {
    const usernameInput = document.getElementById('user-input');
    const username = usernameInput.value.trim();
    const errorLog = document.getElementById('error-log');

    // Validación simple
    if (!username) {
        errorLog.innerText = "⚠️ Por favor ingresa un nombre.";
        return;
    }

    try {
        console.log("Intentando conectar como:", username);
        // Enviamos petición POST al servidor Python local
        const response = await fetch('/connect', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username: username })
        });
        const result = await response.json();

        if (result.status === 'ok') {
            console.log("Conexión exitosa. Iniciando chat...");
            
            // Ocultar panel de login y mostrar chat
            document.getElementById('conn-frame').style.display = 'none';
            document.getElementById('chat-container').style.display = 'flex';
            
            // Limpiar chat previo por si acaso
            document.getElementById('chat-area').innerHTML = ''; 
            
            // Mensaje local de bienvenida
            agregarMensajeHTML("sys-login", "✅ ", `Conectado como ${username}`);
            
            // Iniciar el ciclo de "Polling" (Preguntar por mensajes cada 500ms)
            if (pollingInterval) clearInterval(pollingInterval);
            pollingInterval = setInterval(verificarMensajes, 500);
        } else {
            errorLog.innerText = "Error servidor: " + result.msg;
        }
    } catch (e) {
        console.error("Error al conectar:", e);
        errorLog.innerText = "No se pudo contactar con el script Python local.";
    }
}

async function desconectar() {
    // Intentamos avisar al servidor antes de irnos
    try { await fetch('/disconnect', { method: 'POST' }); } catch(e) {}
    
    // Recargar la página limpia todo el estado visual y de JS
    location.reload(); 
}

// ==========================================
// 2. ENVÍO DE MENSAJES
// ==========================================

async function enviarMensaje() {
    const input = document.getElementById('msg-input');
    const msg = input.value;
    if (!msg) return;

    // A) Feedback Instantáneo (Optimistic UI)
    // Mostramos el mensaje como "Tú" inmediatamente, sin esperar al servidor.
    // Solo si NO es un comando (los comandos no se muestran como 'Tú')
    if (!msg.startsWith('/')) {
        // Usamos Date.now() para generar un ID único temporal
        agregarMensajeHTML("local-" + Date.now(), "💬 Tú: ", msg);
    }
    
    input.value = ""; // Limpiar input para escribir el siguiente

    // B) Enviar al backend (Python)
    try {
        await fetch('/send', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ message: msg })
        });
    } catch (e) {
        console.error("Error enviando mensaje:", e);
        agregarMensajeHTML("sys-err", "❌ ", "Error al enviar mensaje (¿Servidor caído?)");
    }
}

// ==========================================
// 3. POLLING (RECEPCIÓN DE DATOS)
// ==========================================

async function verificarMensajes() {
    try {
        const response = await fetch('/poll');
        if (!response.ok) throw new Error("Error en poll");
        
        const mensajes = await response.json();

        // Si hay mensajes nuevos en la cola, procesarlos uno por uno
        if (mensajes && mensajes.length > 0) {
            // console.log("Mensajes recibidos:", mensajes); // Descomentar para depurar
            mensajes.forEach(data => {
                procesarMensaje(data);
            });
        }
    } catch (e) {
        // Si falla el poll muchas veces, es probable que Python se haya cerrado
        console.warn("Error verificando mensajes:", e);
    }
}

function procesarMensaje(data) {
    // Protección contra datos corruptos o nulos
    if (!data) return;

    // 1. Mensajes de Estado (Desconexión forzada por timeout, etc.)
    if (data.type === 'status' && data.payload) {
        if (data.payload.includes("Desconectado")) {
            alert(data.payload); // Avisar al usuario
            location.reload();   // Reiniciar
            return;
        }
        // Otros estados (ej: "Conectando...")
        document.getElementById('status-label').innerText = data.payload;
        return;
    }

    // 2. Mensajes de Chat (Normales, Juego o Sistema)
    if (data.type === 'chat') {
        const id = data.id || "msg-" + Date.now() + Math.random();
        const prefix = data.prefix || ""; 
        const payload = data.payload || "";
        
        agregarMensajeHTML(id, prefix, payload);
    } 
    
    // 3. Comandos Administrativos (Limpiar Chat)
    else if (data.type === 'clear') {
        document.getElementById('chat-area').innerHTML = 
            '<div class="chat-message server">📢 El chat fue limpiado por un administrador.</div>';
    } 
    
    // 4. Comandos Administrativos (Borrar Mensaje Específico)
    else if (data.type === 'delete') {
        const el = document.getElementById(data.id);
        if (el) {
            el.innerHTML = "<i>Mensaje eliminado por admin</i>";
            el.classList.add("deleted"); // Clase CSS para texto rojo/tachado
        }
    }
}

// ==========================================
// 4. MANIPULACIÓN DEL DOM (HTML)
// ==========================================

function agregarMensajeHTML(id, prefix, payload) {
    const chatArea = document.getElementById('chat-area');
    if (!chatArea) return;

    // Detectar si es un mensaje especial para darle estilo diferente (Verde/Neon)
    let claseExtra = "";
    
    // Lista de prefijos que activan el "Estilo Sistema/Juego"
    if (prefix.includes("Servidor") || // Mensajes del sistema
        prefix.includes("ADMIN") ||    // Mensajes de admin
        prefix.includes("✅") ||       // Login/Éxito
        prefix.includes("❌") ||       // Error/Salida
        prefix.includes("⛔") ||       // Kick/Ban
        prefix.includes("🎲") ||       // Evento de Juego (Inicio)
        prefix.includes("⭐") ||       // Victoria de Juego
        prefix.includes("⚠️")) {       // Advertencias
        
        claseExtra = "server"; // Aplica color verde/especial definido en CSS
    }

    // Crear el elemento DIV del mensaje
    const div = document.createElement('div');
    div.className = `chat-message ${claseExtra}`;
    div.id = id;
    
    // Construir el HTML interno de forma segura
    // Nota: innerHTML permite que los emojis y negritas se vean bien
    const safePrefix = prefix ? `<strong>${prefix}</strong>` : "";
    div.innerHTML = `${safePrefix}${payload}`;

    // Añadir al chat
    chatArea.appendChild(div);
    
    // Auto-scroll hacia el final para ver lo nuevo
    chatArea.scrollTop = chatArea.scrollHeight;
}

// ==========================================
// 5. EVENT LISTENERS (TECLADO Y VENTANA)
// ==========================================

window.onload = function() {
    // Permitir enviar con la tecla ENTER en los inputs
    const msgInput = document.getElementById('msg-input');
    const userInput = document.getElementById('user-input');

    if (msgInput) {
        msgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') enviarMensaje();
        });
    }

    if (userInput) {
        userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') conectar();
        });
    }
};

// Intento de desconexión "amable" si el usuario cierra la pestaña
window.addEventListener('beforeunload', function () {
    // sendBeacon es mejor que fetch para eventos de cierre porque no bloquea
    navigator.sendBeacon('/disconnect');
});

// --- Función para botones de Juego (Nueva) ---
async function ejecutarComando(comando) {
    // 1. Efecto visual: botón presionado
    console.log("Ejecutando comando:", comando);

    // 2. Enviar directamente al servidor
    try {
        await fetch('/send', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ message: comando })
        });
    } catch (e) {
        console.error("Error al ejecutar comando:", e);
        alert("No se pudo enviar el comando al servidor.");
    }
}