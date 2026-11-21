package com.ziaai.companion

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    private lateinit var serverUrlInput: EditText
    private lateinit var userNameInput: EditText
    private lateinit var permMicStatus: TextView
    private lateinit var permOverlayStatus: TextView
    private lateinit var permAccStatus: TextView
    private lateinit var copilotSwitch: Switch
    private lateinit var statusText: TextView

    private val overlayRequestCode = 1001
    private val micRequestCode = 1002
    private val projectionRequestCode = 1003
    private val notifRequestCode = 1004

    private var pendingWithScreen = false
    private var pendingScreenUpgradeOnly = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        serverUrlInput = findViewById(R.id.serverUrlInput)
        userNameInput = findViewById(R.id.userNameInput)
        permMicStatus = findViewById(R.id.permMicStatus)
        permOverlayStatus = findViewById(R.id.permOverlayStatus)
        permAccStatus = findViewById(R.id.permAccStatus)
        copilotSwitch = findViewById(R.id.copilotSwitch)
        statusText = findViewById(R.id.statusText)

        val activateLiveScreenBtn: Button = findViewById(R.id.activateLiveScreenBtn)
        val activateVoiceOnlyBtn: Button = findViewById(R.id.activateVoiceOnlyBtn)
        val accessibilityBtn: Button = findViewById(R.id.accessibilityBtn)
        val stopOverlayBtn: Button = findViewById(R.id.stopOverlayBtn)

        val prefs = getSharedPreferences("zia_companion_prefs", MODE_PRIVATE)
        serverUrlInput.setText(prefs.getString("server_url", "") ?: "")
        userNameInput.setText(prefs.getString("user_name", "") ?: "")
        copilotSwitch.isChecked = prefs.getBoolean("copilot_enabled", false) &&
            PermissionHelper.isAccessibilityEnabled(this)

        copilotSwitch.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked && !PermissionHelper.isAccessibilityEnabled(this)) {
                copilotSwitch.isChecked = false
                PermissionHelper.showFriendlySettingsDialog(
                    activity = this,
                    title = "Liberar Copiloto de Jogos",
                    message = "Para a Zia dar toques reais na tela durante os jogos, ative 'Zia AI Live' em Acessibilidade.",
                    positiveLabel = "Ir para Acessibilidade"
                ) {
                    PermissionHelper.openAccessibilitySettings(this)
                }
                return@setOnCheckedChangeListener
            }
            getSharedPreferences("zia_companion_prefs", MODE_PRIVATE)
                .edit()
                .putBoolean("copilot_enabled", isChecked)
                .apply()
            syncConfigWithRunningService(isChecked)
        }

        activateLiveScreenBtn.setOnClickListener {
            beginLiveActivation(withScreen = true)
        }

        activateVoiceOnlyBtn.setOnClickListener {
            beginLiveActivation(withScreen = false)
        }

        accessibilityBtn.setOnClickListener {
            PermissionHelper.showFriendlySettingsDialog(
                activity = this,
                title = "Acessibilidade — Modo Copiloto",
                message = "Na próxima tela, procure 'Zia AI Live' (ou Serviços Instalados) e ative para a Zia poder clicar na tela quando você ligar o Copiloto.",
                positiveLabel = "Abrir Acessibilidade"
            ) {
                PermissionHelper.openAccessibilitySettings(this)
            }
        }

        stopOverlayBtn.setOnClickListener {
            stopService(Intent(this, ZiaFloatingService::class.java))
            statusText.text = "Bolinha flutuante encerrada com segurança."
        }

        handleExtraActionIntent(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent != null) {
            setIntent(intent)
            handleExtraActionIntent(intent)
        }
    }

    override fun onResume() {
        super.onResume()
        refreshPermissionChecklist()
    }

    private fun handleExtraActionIntent(intent: Intent?) {
        if (intent?.getBooleanExtra("extra_request_screen", false) == true) {
            intent.removeExtra("extra_request_screen")
            pendingScreenUpgradeOnly = true
            requestScreenProjectionSafely()
        }
    }

    private fun refreshPermissionChecklist() {
        val micOk = PermissionHelper.hasRecordAudio(this)
        val overlayOk = PermissionHelper.hasOverlayPermission(this)
        val accOk = PermissionHelper.isAccessibilityEnabled(this)

        permMicStatus.text = if (micOk) "🎤 Microfone: Liberado" else "🎤 Microfone: Pendente (obrigatório)"
        permMicStatus.setTextColor(if (micOk) 0xFF34D399.toInt() else 0xFFFBBF24.toInt())

        permOverlayStatus.text = if (overlayOk) "🫧 Bolinha Sobreposta: Liberada" else "🫧 Bolinha Sobreposta: Pendente (obrigatória)"
        permOverlayStatus.setTextColor(if (overlayOk) 0xFF34D399.toInt() else 0xFFFBBF24.toInt())

        permAccStatus.text = if (accOk) "🎮 Copiloto (Acessibilidade): Liberado" else "🎮 Copiloto (Acessibilidade): Opcional (desligado)"
        permAccStatus.setTextColor(if (accOk) 0xFF34D399.toInt() else 0xFF94A3B8.toInt())

        if (!accOk && copilotSwitch.isChecked) {
            copilotSwitch.isChecked = false
        }
    }

    private fun saveCurrentConfig(): String? {
        val url = serverUrlInput.text.toString().trim().trimEnd('/')
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            Toast.makeText(this, "Cole a URL do servidor Zia AI (https://...)", Toast.LENGTH_SHORT).show()
            return null
        }
        val name = userNameInput.text.toString().trim()
        getSharedPreferences("zia_companion_prefs", MODE_PRIVATE)
            .edit()
            .putString("server_url", url)
            .putString("user_name", name)
            .putBoolean("copilot_enabled", copilotSwitch.isChecked)
            .apply()
        return url
    }

    private fun beginLiveActivation(withScreen: Boolean) {
        val url = saveCurrentConfig() ?: return
        pendingWithScreen = withScreen
        pendingScreenUpgradeOnly = false

        // 1. Check RECORD_AUDIO
        if (!PermissionHelper.hasRecordAudio(this)) {
            statusText.text = "Pedindo permissão do microfone para a conversa ao vivo..."
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), micRequestCode)
            return
        }

        // 2. Check POST_NOTIFICATIONS on Android 13+ (needed to show persistent Foreground notification)
        if (!PermissionHelper.hasPostNotifications(this) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), notifRequestCode)
            return
        }

        // 3. Check SYSTEM_ALERT_WINDOW (floating orb over any game)
        if (!PermissionHelper.hasOverlayPermission(this)) {
            PermissionHelper.showFriendlySettingsDialog(
                activity = this,
                title = "Permitir Bolinha Flutuante",
                message = "Para a bolinha animada da Zia aparecer por cima de jogos e outros apps, libere 'Sobrepor a outros apps'.",
                positiveLabel = "Liberar Agora"
            ) {
                PermissionHelper.openOverlaySettings(this, overlayRequestCode)
            }
            return
        }

        // 4. Optional Accessibility warning if user toggled Copiloto ON
        if (copilotSwitch.isChecked && !PermissionHelper.isAccessibilityEnabled(this)) {
            copilotSwitch.isChecked = false
            PermissionHelper.showFriendlySettingsDialog(
                activity = this,
                title = "Ativar Copiloto de Jogos",
                message = "O Modo Copiloto precisa que 'Zia AI Live' esteja ligado em Acessibilidade.",
                positiveLabel = "Ir para Acessibilidade"
            ) {
                PermissionHelper.openAccessibilitySettings(this)
            }
            return
        }

        // 5. Screen Vision + Game Internal Audio (MediaProjection)
        if (withScreen) {
            requestScreenProjectionSafely()
        } else {
            launchFloatingLiveService(url, Activity.RESULT_CANCELED, null)
        }
    }

    private fun requestScreenProjectionSafely() {
        try {
            val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            startActivityForResult(mgr.createScreenCaptureIntent(), projectionRequestCode)
        } catch (_: Exception) {
            Toast.makeText(this, "Não foi possível abrir captura de tela neste aparelho.", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refreshPermissionChecklist()
        if (requestCode == micRequestCode) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
                beginLiveActivation(pendingWithScreen)
            } else {
                PermissionHelper.showFriendlySettingsDialog(
                    activity = this,
                    title = "Microfone Necessário",
                    message = "Sem permissão de microfone a Zia não consegue conversar com você ao vivo. Libere nas configurações do app.",
                    positiveLabel = "Abrir Ajustes"
                ) {
                    PermissionHelper.openAppDetailsSettings(this)
                }
            }
        } else if (requestCode == notifRequestCode) {
            beginLiveActivation(pendingWithScreen)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        refreshPermissionChecklist()

        if (requestCode == overlayRequestCode) {
            if (PermissionHelper.hasOverlayPermission(this)) {
                beginLiveActivation(pendingWithScreen)
            } else {
                statusText.text = "Permissão de sobreposição não concedida ainda."
            }
        } else if (requestCode == projectionRequestCode) {
            val url = getSharedPreferences("zia_companion_prefs", MODE_PRIVATE)
                .getString("server_url", "")
                ?.trimEnd('/') ?: ""
            if (resultCode == Activity.RESULT_OK && data != null && url.isNotBlank()) {
                launchFloatingLiveService(url, resultCode, data)
            } else if (pendingScreenUpgradeOnly) {
                pendingScreenUpgradeOnly = false
                Toast.makeText(this, "Captura de tela cancelada.", Toast.LENGTH_SHORT).show()
            } else if (url.isNotBlank()) {
                Toast.makeText(
                    this,
                    "Iniciando só com voz (você pode ativar Ver Tela depois segurando a bolinha).",
                    Toast.LENGTH_LONG
                ).show()
                launchFloatingLiveService(url, Activity.RESULT_CANCELED, null)
            }
        }
    }

    private fun syncConfigWithRunningService(copilotEnabled: Boolean) {
        if (!ZiaFloatingService.isRunning) return
        val url = serverUrlInput.text.toString().trim().trimEnd('/')
        if (url.isBlank()) return
        try {
            val intent = Intent(this, ZiaFloatingService::class.java).apply {
                action = ZiaFloatingService.ACTION_UPDATE_CONFIG
                putExtra("server_url", url)
                putExtra("user_name", userNameInput.text.toString().trim())
                putExtra("copilot_enabled", copilotEnabled)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        } catch (_: Exception) {
        }
    }

    private fun launchFloatingLiveService(
        serverUrl: String,
        projResultCode: Int,
        projData: Intent?
    ) {
        try {
            val serviceIntent = Intent(this, ZiaFloatingService::class.java).apply {
                putExtra("server_url", serverUrl)
                putExtra("user_name", userNameInput.text.toString().trim())
                putExtra("copilot_enabled", copilotSwitch.isChecked)
                if (projResultCode == Activity.RESULT_OK && projData != null) {
                    putExtra("proj_result_code", projResultCode)
                    putExtra("proj_data", projData)
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
            statusText.text = if (projResultCode == Activity.RESULT_OK) {
                "ZIA Live ativa! Vendo tela, ouvindo áudio do jogo e pronta sobre qualquer app."
            } else {
                "ZIA Live ativa! Bolinha de voz pronta por cima de qualquer jogo."
            }
            moveTaskToBack(true)
        } catch (e: Exception) {
            statusText.text = "Não foi possível iniciar o serviço: ${e.message}"
        }
    }
}
