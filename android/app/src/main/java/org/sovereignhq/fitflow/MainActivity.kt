package org.sovereignhq.fitflow

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature

/**
 * FitFlow is one self-contained HTML file. This activity is the shell around it.
 *
 * The page is served through [WebViewAssetLoader] rather than a `file://` URL so it
 * gets a real https origin. That matters for three things the app depends on: the
 * camera (only granted to a secure context), and cross-origin calls to Claude and
 * to the food database (a `file://` page is an opaque origin that both reject).
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView

    /** Set while the page is waiting on a camera grant, so the answer can be relayed. */
    private var pendingCamera: PermissionRequest? = null

    /** Set while the page's file input is open. */
    private var pendingFiles: ValueCallback<Array<Uri>>? = null

    private val askCamera = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val request = pendingCamera
        pendingCamera = null
        if (request == null) return@registerForActivityResult
        if (granted) request.grant(request.resources) else request.deny()
    }

    private val pickFile = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val callback = pendingFiles
        pendingFiles = null
        // A null answer is required when the chooser is dismissed, or the page's
        // file input stays wedged and never opens again.
        callback?.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
                ?: emptyArray(),
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true          // the whole log lives in localStorage
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportZoom(false)

            // Let the page's own dark CSS answer prefers-color-scheme instead of
            // having the WebView invert it.
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, true)
            }

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    val url = request.url
                    if (url.host == APP_HOST) return false
                    // Anything pointing elsewhere is a real link: hand it to the browser
                    // rather than stranding the user outside the app with no way back.
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    return true
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    val wantsCamera = request.resources
                        .contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                    if (!wantsCamera) {
                        request.deny()
                        return
                    }
                    runOnUiThread {
                        val held = ContextCompat.checkSelfPermission(
                            this@MainActivity, Manifest.permission.CAMERA,
                        ) == PackageManager.PERMISSION_GRANTED
                        if (held) {
                            request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                        } else {
                            pendingCamera = request
                            askCamera.launch(Manifest.permission.CAMERA)
                        }
                    }
                }

                override fun onShowFileChooser(
                    view: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams,
                ): Boolean {
                    pendingFiles?.onReceiveValue(null)      // a previous chooser never answered
                    pendingFiles = callback
                    return runCatching {
                        pickFile.launch(params.createIntent())
                        true
                    }.getOrElse {
                        pendingFiles = null
                        callback.onReceiveValue(null)
                        false
                    }
                }
            }

            loadUrl("https://$APP_HOST/index.html")
        }

        setContentView(web)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) {
                    web.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    override fun onDestroy() {
        pendingFiles?.onReceiveValue(null)
        pendingFiles = null
        super.onDestroy()
    }

    private companion object {
        /** WebViewAssetLoader's reserved host; it resolves to the APK's own assets. */
        const val APP_HOST = "appassets.androidplatform.net"
    }
}
