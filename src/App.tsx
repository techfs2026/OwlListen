import { useState, useEffect } from "react";
import { injectGlobalStyles } from "@/styles";
import { HomeScreen, type AppMode } from "@/components/home/HomeScreen";
import { AnnotateScreen } from "@/components/annotate/AnnotateScreen";
import { ListenScreen } from "@/components/listen/ListenScreen";
import { AudiobookScreen } from "@/components/audiobook/AudiobookScreen";

export default function App() {
  const [mode, setMode] = useState<AppMode>("home");

  useEffect(() => {
    injectGlobalStyles();
  }, []);

  if (mode === "annotate")  return <AnnotateScreen  onBack={() => setMode("home")} />;
  if (mode === "listen")    return <ListenScreen    onBack={() => setMode("home")} />;
  if (mode === "audiobook") return <AudiobookScreen onBack={() => setMode("home")} />;
  return <HomeScreen onSelect={setMode} />;
}