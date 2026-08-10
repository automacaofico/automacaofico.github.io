package io.github.automacaofico.tracker;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.BatteryManager;
import android.os.IBinder;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class TrackingService extends Service {
    private static final String CHANNEL="fico_tracking";
    private final ExecutorService network=Executors.newSingleThreadExecutor();
    private final AtomicBoolean uploading=new AtomicBoolean(false);
    private FusedLocationProviderClient locationClient; private QueueDb db; private long sequence;
    private final LocationCallback callback=new LocationCallback(){ @Override public void onLocationResult(LocationResult result){ Location location=result.getLastLocation(); if(location!=null) capture(location); }};

    @Override public void onCreate(){ super.onCreate(); db=new QueueDb(this); locationClient=LocationServices.getFusedLocationProviderClient(this); createChannel(); startForeground(1001,notification("Aguardando sinal GPS")); }
    @Override public int onStartCommand(Intent intent,int flags,int startId){ startLocation(); return START_STICKY; }
    private void startLocation(){
        if(ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)!= PackageManager.PERMISSION_GRANTED){ stopSelf(); return; }
        LocationRequest request=new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY,5000).setMinUpdateIntervalMillis(3000).setMaxUpdateDelayMillis(5000).build();
        locationClient.requestLocationUpdates(request,callback, Looper.getMainLooper());
    }
    private void capture(Location l){
        try{
            JSONObject p=new JSONObject(); p.put("capturedAt", Instant.ofEpochMilli(l.getTime()).toString()); p.put("latitude",l.getLatitude()); p.put("longitude",l.getLongitude()); p.put("accuracyM",l.getAccuracy()); p.put("sequenceNo",++sequence); p.put("batteryPct",battery());
            if(l.hasSpeed())p.put("speedMps",l.getSpeed()); if(l.hasBearing())p.put("bearingDeg",l.getBearing()); if(l.hasAltitude())p.put("altitudeM",l.getAltitude());
            db.add(p.toString()); String gps=String.format(java.util.Locale.US,"%.6f, %.6f · ±%dm",l.getLatitude(),l.getLongitude(),Math.round(l.getAccuracy())); prefs().edit().putString("lastGps",gps).putInt("queue",db.count()).apply();
            ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(1001,notification("GPS ativo · "+gps)); upload();
        }catch(Exception ignored){}
    }
    private int battery(){ Intent status=registerReceiver(null,new IntentFilter(Intent.ACTION_BATTERY_CHANGED)); if(status==null)return -1; int level=status.getIntExtra(BatteryManager.EXTRA_LEVEL,-1),scale=status.getIntExtra(BatteryManager.EXTRA_SCALE,100); return Math.round(level*100f/scale); }
    private void upload(){ if(!uploading.compareAndSet(false,true))return; network.execute(()->{ try{ String token=prefs().getString("deviceToken",""); if(token.isEmpty())throw new IllegalStateException("Aparelho não vinculado"); while(true){ List<QueueDb.Item> items=db.first(100); if(items.isEmpty())break; JSONArray array=new JSONArray(); for(QueueDb.Item item:items)array.put(new JSONObject(item.payload)); JSONObject body=new JSONObject().put("positions",array); HttpURLConnection c=(HttpURLConnection)new URL(BuildConfig.API_URL+"/api/v2/positions").openConnection(); c.setRequestMethod("POST"); c.setConnectTimeout(12000); c.setReadTimeout(12000); c.setRequestProperty("Authorization","Bearer "+token); c.setRequestProperty("Content-Type","application/json"); c.setDoOutput(true); try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));} int code=c.getResponseCode(); c.disconnect(); if(code<200||code>=300)throw new IllegalStateException("HTTP "+code); db.deleteThrough(items.get(items.size()-1).id); prefs().edit().putString("lastSend","enviado agora").putInt("queue",db.count()).apply(); } }catch(Exception e){ prefs().edit().putString("lastSend","aguardando turno ou conexão").putInt("queue",db.count()).apply(); }finally{uploading.set(false);} }); }
    private android.content.SharedPreferences prefs(){return getSharedPreferences("tracker",MODE_PRIVATE);}
    private void createChannel(){ NotificationChannel channel=new NotificationChannel(CHANNEL,"Rastreamento ferroviário",NotificationManager.IMPORTANCE_LOW); channel.setDescription("Mantém a posição do equipamento sendo transmitida"); ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel); }
    private Notification notification(String text){ String operator=prefs().getString("operatorName","FICO Tracker"); return new NotificationCompat.Builder(this,CHANNEL).setSmallIcon(R.drawable.ic_launcher).setContentTitle(operator+" · rastreamento ativo").setContentText(text).setOngoing(true).setCategory(NotificationCompat.CATEGORY_SERVICE).build(); }
    @Override public void onDestroy(){ locationClient.removeLocationUpdates(callback); network.shutdown(); prefs().edit().putBoolean("running",false).apply(); super.onDestroy(); }
    @Nullable @Override public IBinder onBind(Intent intent){return null;}
}
