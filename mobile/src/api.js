import Constants from "expo-constants";
import { Platform } from "react-native";

export function apiBase() {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host && host !== "localhost" && host !== "127.0.0.1") return `http://${host}:3000`;
  if (Platform.OS === "android") return "http://10.0.2.2:3000";
  return "http://127.0.0.1:3000";
}

async function request(path, options) {
  const response = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "请求失败");
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export function fetchUsage(userId) {
  return request(`/api/usage?userId=${encodeURIComponent(userId)}`);
}

export function fetchNotes(userId) {
  return request(`/api/notes?userId=${encodeURIComponent(userId)}`);
}

export function createNote({ userId, requestId, text }) {
  return request("/api/notes", {
    method: "POST",
    body: JSON.stringify({ userId, requestId, text }),
  });
}

export function replyNote(id, { userId, text }) {
  return request(`/api/notes/${id}/reply`, {
    method: "POST",
    body: JSON.stringify({ userId, text }),
  });
}
