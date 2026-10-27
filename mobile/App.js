import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { createNote, fetchNotes, fetchUsage, replyNote } from "./src/api";
import { needsReply, quickReplies } from "./src/replies";
import { getUserId } from "./src/storage";

function createId() {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

const PRESETS = [
  "下周三下午三点约张总吃饭，提前一天提醒我",
  "下周三约张总吃饭是几点？提醒设在哪天？",
];

export default function App() {
  const [userId, setUserId] = useState("");
  const [notes, setNotes] = useState([]);
  const [usage, setUsage] = useState({ count: 0, limit: 10 });
  const [selectedId, setSelectedId] = useState(null);
  const [composing, setComposing] = useState(false);
  const [view, setView] = useState("all");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingId, setPendingId] = useState(null);

  const selected = composing ? null : notes.find((note) => note.id === selectedId) || null;
  const continuing = !composing && needsReply(selected);

  const refresh = useCallback(async (id) => {
    const [nextUsage, nextNotes] = await Promise.all([fetchUsage(id), fetchNotes(id)]);
    setUsage(nextUsage);
    setNotes(nextNotes);
    return nextNotes;
  }, []);

  useEffect(() => {
    getUserId().then(async (id) => {
      setUserId(id);
      const nextNotes = await refresh(id);
      if (nextNotes[0]) setSelectedId(nextNotes[0].id);
    }).catch((error) => setNotice(error.message));
  }, [refresh]);

  async function send(value) {
    const content = value.trim();
    if (!content || busy || !userId) return;
    const replyTo = continuing ? selected : null;
    const requestId = pendingId || createId();
    if (!replyTo) setPendingId(requestId);
    setBusy(true);
    setDraft(content);
    setNotice("");
    try {
      const body = replyTo
        ? await replyNote(replyTo.id, { userId, text: content })
        : await createNote({ userId, requestId, text: content });
      setPendingId(null);
      setComposing(false);
      setSelectedId(body.id);
      setView("all");
      setText("");
      setNotice(body.status === "asking" ? "还需要补充，这次回复不另扣次数。" : "");
      await refresh(userId);
    } catch (error) {
      if (!replyTo && error.status !== 502) setPendingId(null);
      setNotice(error.message || "发送失败");
      if (error.body?.usage) setUsage(error.body.usage);
    } finally {
      setBusy(false);
      setDraft("");
    }
  }

  function startNew() {
    setComposing(true);
    setSelectedId(null);
    setPendingId(null);
    setView("all");
    setText("");
    setNotice("");
  }

  const messages = selected?.messages?.length
    ? selected.messages
    : selected?.summary
      ? [{ role: "assistant", content: selected.summary }]
      : [];
  const visibleMessages = busy ? [...messages, { role: "user", content: draft }] : messages;

  return (
    <SafeAreaProvider>
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.mark}><Text style={styles.markText}>N</Text></View>
            <Text style={styles.brand}>Nota</Text>
            <Text style={styles.badge}>AI</Text>
          </View>
          <Pressable onPress={startNew}><Text style={styles.newLink}>新建</Text></Pressable>
        </View>
        <Text style={styles.quota}>今日已用 {usage.count} / {usage.limit}</Text>

        <View style={styles.nav}>
          {[
            ["all", "记录"],
            ["todos", "待办"],
            ["reminders", "提醒"],
          ].map(([id, label]) => (
            <Pressable key={id} style={[styles.navItem, view === id && styles.navItemOn]} onPress={() => setView(id)}>
              <Text style={[styles.navText, view === id && styles.navTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar} contentContainerStyle={styles.chips}>
          {notes.map((note) => (
            <Pressable
              key={note.id}
              style={[styles.chip, !composing && note.id === selected?.id && view === "all" && styles.chipOn]}
              onPress={() => { setComposing(false); setSelectedId(note.id); setView("all"); }}
            >
              <Text style={styles.chipText} numberOfLines={1}>{(note.summary || note.text || "未命名").slice(0, 12)}</Text>
            </Pressable>
          ))}
          {!notes.length ? <Text style={styles.empty}>还没有记录</Text> : null}
        </ScrollView>

        {view !== "all" ? (
          <ScrollView contentContainerStyle={styles.listPage}>
            {view === "todos" ? <TodoList notes={notes} /> : <ReminderList notes={notes} />}
          </ScrollView>
        ) : (
          <View style={styles.stack}>
            <View style={styles.module}>
              <ScrollView style={styles.dialogue} contentContainerStyle={styles.dialogueContent} keyboardShouldPersistTaps="handled">
                {!busy && !selected ? <Text style={styles.empty}>整理之后，对话会出现在这里。</Text> : null}
                {visibleMessages.map((item, index) => (
                  <Bubble
                    key={`${item.role}-${index}`}
                    item={item}
                    replies={!busy && item.role === "assistant" && index === messages.length - 1 && needsReply(selected) ? quickReplies(selected) : []}
                    onReply={send}
                  />
                ))}
                {busy ? (
                  <View style={styles.theirs}>
                    <ActivityIndicator color="#1c2ac8" />
                    <Text style={styles.loadingText}>正在整理…</Text>
                  </View>
                ) : null}
              </ScrollView>
              {!busy && needsReply(selected) ? <Text style={styles.hint}>点消息下的回复即可，这一轮不另扣次数。</Text> : null}
            </View>
            {!busy && selected ? <Summary note={selected} /> : null}
          </View>
        )}

        {view === "all" ? (
          <View style={styles.composer}>
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presets}>
              {PRESETS.map((preset) => (
                <Pressable key={preset} style={styles.preset} onPress={() => setText(preset)}>
                  <Text style={styles.presetText} numberOfLines={1}>{preset}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder={continuing ? "回复刚才的问题" : "记一件事，或问以前的安排"}
                placeholderTextColor="#757687"
                multiline
              />
              <Pressable
                style={[styles.send, (!text.trim() || busy) && styles.sendDisabled]}
                disabled={!text.trim() || busy}
                onPress={() => send(text)}
              >
                <Text style={[styles.sendText, (!text.trim() || busy) && styles.sendTextDisabled]}>
                  {busy ? "发送中" : "发送"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Bubble({ item, replies = [], onReply }) {
  return (
    <View style={item.role === "user" ? styles.mine : styles.theirs}>
      <Text style={styles.bubbleText}>{item.content}</Text>
      {replies.length ? (
        <View style={styles.replies}>
          {replies.map((reply) => (
            <Pressable key={reply} style={styles.reply} onPress={() => onReply(reply)}>
              <Text style={styles.replyText}>{reply}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Summary({ note }) {
  return (
    <ScrollView style={styles.result} contentContainerStyle={styles.resultContent} nestedScrollEnabled>
      <View style={styles.block}>
        <Text style={styles.kicker}>摘要</Text>
        <Text style={styles.summaryText}>{note.summary || "还没有摘要"}</Text>
      </View>
      <View style={styles.block}>
        <Text style={styles.kicker}>待办</Text>
        {(note.todos || []).map((item) => <Text key={item.id} style={styles.summaryText}>{item.content}</Text>)}
        {!note.todos?.length ? <Text style={styles.summaryText}>还没有待办</Text> : null}
      </View>
      <View style={styles.block}>
        <Text style={styles.kicker}>提醒</Text>
        {(note.reminders || []).map((item) => <Text key={item.id} style={styles.summaryText}>{item.remindAt} {item.content}</Text>)}
        {!note.reminders?.length ? <Text style={styles.summaryText}>还没有提醒</Text> : null}
      </View>
    </ScrollView>
  );
}

function TodoList({ notes }) {
  const items = notes.flatMap((note) => (note.todos || []).map((todo) => ({ ...todo, title: note.summary || note.text })));
  if (!items.length) return <Text style={styles.empty}>还没有待办</Text>;
  return items.map((item) => (
    <View key={item.id} style={styles.listCard}>
      <Text style={styles.listTitle}>{item.content}</Text>
      <Text style={styles.listMeta} numberOfLines={1}>{item.title}</Text>
    </View>
  ));
}

function ReminderList({ notes }) {
  const items = notes.flatMap((note) => (note.reminders || []).map((item) => ({ ...item, title: note.summary || note.text })));
  if (!items.length) return <Text style={styles.empty}>还没有提醒</Text>;
  return items.map((item) => (
    <View key={item.id} style={styles.listCard}>
      <Text style={styles.listTitle}>{item.remindAt} {item.content}</Text>
      <Text style={styles.listMeta} numberOfLines={1}>{item.title}</Text>
    </View>
  ));
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#faf9fb" },
  header: { paddingHorizontal: 20, paddingTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  mark: { width: 28, height: 28, borderRadius: 8, backgroundColor: "#3b49df", alignItems: "center", justifyContent: "center" },
  markText: { color: "#fff", fontWeight: "700" },
  brand: { fontSize: 22, color: "#1b1c1e" },
  badge: { backgroundColor: "#efedf0", color: "#454655", fontSize: 11, fontWeight: "600", overflow: "hidden", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  newLink: { color: "#1c2ac8", fontSize: 14, fontWeight: "600" },
  quota: { paddingHorizontal: 20, paddingBottom: 8, fontSize: 12, color: "#757687" },
  chips: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  chipBar: { flexGrow: 0, height: 44 },
  stack: { flex: 1 },
  module: { flex: 1, marginHorizontal: 16, marginBottom: 8, backgroundColor: "#ffffff", borderRadius: 16, padding: 12 },
  result: { flexGrow: 0, maxHeight: 112, marginHorizontal: 16, marginBottom: 8, backgroundColor: "#ffffff", borderRadius: 16 },
  resultContent: { padding: 12, gap: 8 },
  dialogue: { flex: 1 },
  dialogueContent: { gap: 8, paddingBottom: 4 },
  chip: { maxWidth: 140, backgroundColor: "#efedf0", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  block: { backgroundColor: "#f5f3f5", borderRadius: 12, padding: 10, gap: 4 },
  chipOn: { backgroundColor: "#e3e2e4" },
  chipText: { fontSize: 13, color: "#454655" },
  chipTextOn: { color: "#1b1c1e", fontWeight: "600" },
  nav: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  navItem: { backgroundColor: "#efedf0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  navItemOn: { backgroundColor: "#3b49df" },
  navText: { fontSize: 13, color: "#454655" },
  navTextOn: { color: "#ffffff", fontWeight: "600" },
  empty: { color: "#454655", fontSize: 13, lineHeight: 20, padding: 8 },
  mine: { alignSelf: "flex-end", maxWidth: "88%", backgroundColor: "#e0e0ff", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  theirs: { alignSelf: "flex-start", maxWidth: "88%", backgroundColor: "#f5f3f5", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleText: { fontSize: 13, lineHeight: 20, color: "#1b1c1e" },
  replies: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  reply: { backgroundColor: "#e0e0ff", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  replyText: { fontSize: 13, color: "#000668" },
  loadingText: { marginTop: 6, fontSize: 13, color: "#454655" },
  hint: { fontSize: 12, color: "#757687", paddingHorizontal: 4 },
  summary: { backgroundColor: "#ffffff", borderRadius: 16, padding: 14, gap: 4 },
  kicker: { marginTop: 6, fontSize: 13, fontWeight: "600", color: "#1b1c1e" },
  summaryText: { fontSize: 13, lineHeight: 20, color: "#454655" },
  composer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: 8, backgroundColor: "#faf9fb" },
  notice: { fontSize: 12, color: "#454655" },
  presets: { gap: 8 },
  preset: { maxWidth: 260, backgroundColor: "#f5f3f5", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  presetText: { fontSize: 12, color: "#1b1c1e" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: { flex: 1, minHeight: 44, maxHeight: 96, backgroundColor: "#ffffff", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: "#1b1c1e" },
  send: { backgroundColor: "#1c2ac8", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 },
  sendDisabled: { backgroundColor: "#e3e2e4" },
  sendText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  sendTextDisabled: { color: "#757687" },
  listPage: { padding: 16, gap: 10 },
  listCard: { backgroundColor: "#ffffff", borderRadius: 14, padding: 14 },
  listTitle: { fontSize: 14, color: "#1b1c1e" },
  listMeta: { marginTop: 4, fontSize: 12, color: "#757687" },
});
