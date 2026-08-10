package io.github.automacaofico.tracker;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.util.ArrayList;
import java.util.List;

final class QueueDb extends SQLiteOpenHelper {
    QueueDb(Context context) { super(context, "tracking_queue.db", null, 1); }
    @Override public void onCreate(SQLiteDatabase db) { db.execSQL("CREATE TABLE queue (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)"); }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }
    synchronized long add(String payload) { ContentValues values = new ContentValues(); values.put("payload", payload); return getWritableDatabase().insertOrThrow("queue", null, values); }
    synchronized List<Item> first(int limit) {
        List<Item> items = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().query("queue", new String[]{"id","payload"}, null, null, null, null, "id ASC", String.valueOf(limit))) {
            while (cursor.moveToNext()) items.add(new Item(cursor.getLong(0), cursor.getString(1)));
        }
        return items;
    }
    synchronized void deleteThrough(long id) { getWritableDatabase().delete("queue", "id<=?", new String[]{String.valueOf(id)}); }
    synchronized int count() { try (Cursor cursor = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM queue", null)) { return cursor.moveToFirst() ? cursor.getInt(0) : 0; } }
    static final class Item { final long id; final String payload; Item(long id, String payload) { this.id=id; this.payload=payload; } }
}
