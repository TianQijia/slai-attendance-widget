package cn.slai.attendance;

import org.json.JSONObject;

interface NativeResult {
    void ok(Object value);
    void fail(String code, JSONObject details);
    default void fail(String code) { fail(code, new JSONObject()); }
    static JSONObject object(Object... pairs) {
        JSONObject value = new JSONObject();
        try { for (int i = 0; i < pairs.length; i += 2) value.put((String) pairs[i], JSONObject.wrap(pairs[i + 1])); }
        catch (org.json.JSONException ignored) { /* Callers use fixed keys and supported JSON values. */ }
        return value;
    }
}
