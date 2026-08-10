package io.github.automacaofico.tracker;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.Scanner;

public class MainActivity extends AppCompatActivity {
    private static final int PERMISSIONS = 41;
    private static final String[] EQUIPMENT = {"NTC001","LOCO001","LOCO002","LOCO003","LOCO004","LOCO005","LOCO006","LOCO007","EGPS001","EGPS002","EGPS003","EGPR001","EGPR002","EGPR003"};
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView equipmentTitle, title, detail, lastGps, lastSend, queueCount;
    private Button start, stop, activate;
    private LinearLayout activationPanel, trackingPanel, diagnosticPanel;
    private Spinner equipmentSpinner;
    private EditText activationCode;
    private final Runnable refresh = new Runnable() { @Override public void run() { render(); handler.postDelayed(this, 1000); } };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state); setContentView(R.layout.activity_main);
        equipmentTitle=findViewById(R.id.equipmentTitle); title=findViewById(R.id.stateTitle); detail=findViewById(R.id.stateDetail); lastGps=findViewById(R.id.lastGps); lastSend=findViewById(R.id.lastSend); queueCount=findViewById(R.id.queueCount);
        start=findViewById(R.id.startButton); stop=findViewById(R.id.stopButton); activate=findViewById(R.id.activateButton); activationPanel=findViewById(R.id.activationPanel); trackingPanel=findViewById(R.id.trackingPanel); diagnosticPanel=findViewById(R.id.diagnosticPanel); equipmentSpinner=findViewById(R.id.equipmentSpinner); activationCode=findViewById(R.id.activationCode);
        equipmentSpinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, EQUIPMENT));
        activate.setOnClickListener(v -> activateDevice());
        start.setOnClickListener(v -> requestAndStart());
        stop.setOnClickListener(v -> { stopService(new Intent(this, TrackingService.class)); prefs().edit().putBoolean("running",false).apply(); render(); });
    }
    @Override protected void onResume() { super.onResume(); handler.post(refresh); }
    @Override protected void onPause() { super.onPause(); handler.removeCallbacks(refresh); }

    private SharedPreferences prefs() { return getSharedPreferences("tracker", MODE_PRIVATE); }

    private void activateDevice() {
        String code=activationCode.getText().toString().trim().toUpperCase();
        String equipment=String.valueOf(equipmentSpinner.getSelectedItem());
        if(code.length()<8){ activationCode.setError("Informe o código de ativação"); return; }
        activate.setEnabled(false); activate.setText("ATIVANDO…");
        new Thread(() -> {
            try {
                String installationId=prefs().getString("installationId",null);
                if(installationId==null){ installationId=UUID.randomUUID().toString(); prefs().edit().putString("installationId",installationId).apply(); }
                JSONObject request=new JSONObject().put("equipmentId",equipment).put("activationCode",code).put("installationId",installationId);
                HttpURLConnection connection=(HttpURLConnection)new URL(BuildConfig.API_URL+"/api/v1/activate").openConnection();
                connection.setRequestMethod("POST"); connection.setConnectTimeout(12000); connection.setReadTimeout(12000); connection.setRequestProperty("Content-Type","application/json"); connection.setDoOutput(true);
                try(OutputStream out=connection.getOutputStream()){out.write(request.toString().getBytes(StandardCharsets.UTF_8));}
                int status=connection.getResponseCode(); InputStream stream=status>=200&&status<300?connection.getInputStream():connection.getErrorStream(); Scanner scanner=new Scanner(stream,StandardCharsets.UTF_8.name()).useDelimiter("\\A"); String response=scanner.hasNext()?scanner.next():"{}"; scanner.close(); connection.disconnect(); JSONObject json=new JSONObject(response);
                if(status<200||status>=300) throw new IllegalStateException(json.optString("error","Não foi possível ativar."));
                prefs().edit().putString("equipmentId",json.getString("equipmentId")).putString("deviceToken",json.getString("deviceToken")).apply();
                runOnUiThread(() -> { Toast.makeText(this,equipment+" ativado com sucesso",Toast.LENGTH_LONG).show(); activationCode.setText(""); render(); });
            } catch(Exception error) {
                runOnUiThread(() -> { Toast.makeText(this,error.getMessage(),Toast.LENGTH_LONG).show(); activate.setEnabled(true); activate.setText("ATIVAR EQUIPAMENTO"); });
            }
        }).start();
    }

    private void requestAndStart() {
        if (prefs().getString("deviceToken","").isEmpty()) { detail.setText("Ative este aparelho antes de iniciar."); return; }
        String[] permissions = Build.VERSION.SDK_INT >= 33 ? new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.POST_NOTIFICATIONS} : new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION};
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) ActivityCompat.requestPermissions(this, permissions, PERMISSIONS); else startTracking();
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == PERMISSIONS && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) startTracking(); else detail.setText("A localização precisa é necessária para calcular o KM ferroviário.");
    }
    private void startTracking() {
        ContextCompat.startForegroundService(this, new Intent(this, TrackingService.class));
        prefs().edit().putBoolean("running",true).apply(); render();
        startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
    }
    private void render() {
        SharedPreferences p=prefs(); String equipment=p.getString("equipmentId",""); boolean activated=!equipment.isEmpty(); boolean running=p.getBoolean("running",false);
        equipmentTitle.setText(activated?equipment:"FICO TRACKER"); activationPanel.setVisibility(activated?View.GONE:View.VISIBLE); trackingPanel.setVisibility(activated?View.VISIBLE:View.GONE); diagnosticPanel.setVisibility(activated?View.VISIBLE:View.GONE);
        title.setText(running ? "Transmitindo "+equipment : "Rastreamento parado");
        detail.setText(running ? "O GPS é coletado a cada 5 segundos. Mantenha este aparelho ligado e conectado à Starlink." : "Toque em iniciar e mantenha o celular ligado à Starlink do equipamento.");
        start.setVisibility(running ? View.GONE : View.VISIBLE); stop.setVisibility(running ? View.VISIBLE : View.GONE);
        lastGps.setText("GPS: " + p.getString("lastGps","aguardando")); lastSend.setText("Servidor: " + p.getString("lastSend","nenhum envio")); queueCount.setText("Fila offline: " + p.getInt("queue",0) + " posições");
    }
}
