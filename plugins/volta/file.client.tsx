import type { PluginAgentPanelProps } from "@getpaseo/plugin";
import { useAgent, useRpc } from "@getpaseo/plugin";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { FOLDER_KEY, fileChat } from "./tree.shared";

export function FilePanel({ theme, layout, agentId }: PluginAgentPanelProps) {
  const agent = useAgent(agentId, (snapshot) => ({
    id: snapshot.id,
    title: snapshot.title,
    labels: snapshot.labels,
  }));
  const file = useRpc(fileChat);
  const [folder, setFolder] = useState(agent?.labels[FOLDER_KEY] ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: layout.compact ? 16 : 24,
        gap: 12,
        backgroundColor: theme.colors.surface0,
      },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 18 : 22 },
      sub: { color: theme.colors.foregroundMuted },
      input: {
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        color: theme.colors.foreground,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
      },
      button: {
        backgroundColor: theme.colors.accent,
        borderRadius: 8,
        paddingVertical: 10,
        alignItems: "center" as const,
      },
      buttonText: { color: theme.colors.accentForeground, fontWeight: "600" as const },
    }),
    [theme, layout.compact],
  );

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{agent?.title ?? "This chat"}</Text>
      <Text style={styles.sub}>
        Optional extra path inside its product. The Volta desk still stacks tenant → product →
        chat from Paseo itself.
      </Text>
      <TextInput
        accessibilityLabel="Folder path"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="plugins/volta"
        placeholderTextColor={theme.colors.foregroundMuted}
        value={folder}
        onChangeText={setFolder}
        style={styles.input}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save folder"
        onPress={() => {
          void file({ agentId, folder })
            .then(() => setMessage(`Noted under ${folder.trim() || "no extra path"}`))
            .catch((caught: unknown) =>
              setMessage(caught instanceof Error ? caught.message : "Could not save path"),
            );
        }}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Save extra path</Text>
      </Pressable>
      {message ? <Text style={styles.sub}>{message}</Text> : null}
    </View>
  );
}
