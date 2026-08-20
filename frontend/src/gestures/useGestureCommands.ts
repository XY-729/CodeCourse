import { useEffect, useRef, useState } from "react";
import { GESTURE_COMPLETE_EVENT } from "../components/GestureLayer";
import type { GesturePath } from "./GestureDrawer";
import { recognizeGesture, type GestureShape } from "./GestureRecognizer";

type CommandGesture = Exclude<GestureShape, "invalid">;
type GestureCommands = Record<CommandGesture, () => string | null>;

function pathLength(path: GesturePath) {
  let traveled = 0;
  for (let index = 1; index < path.points.length; index += 1) {
    const previous = path.points[index - 1];
    const point = path.points[index];
    traveled += Math.hypot(point.x - previous.x, point.y - previous.y);
  }
  return traveled;
}

export function useGestureCommands(commands: GestureCommands) {
  const [hint, setHint] = useState<{ id: number; text: string } | null>(null);
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  useEffect(() => {
    function onGestureComplete(event: Event) {
      const path = (event as CustomEvent<GesturePath>).detail;
      const gesture = recognizeGesture(path);
      if (gesture === "invalid") {
        setHint(pathLength(path) >= 28 ? { id: Date.now(), text: "未识别手势，未执行操作" } : null);
        return;
      }
      const text = commandsRef.current[gesture]();
      if (text) setHint({ id: Date.now(), text });
    }

    window.addEventListener(GESTURE_COMPLETE_EVENT, onGestureComplete);
    return () => window.removeEventListener(GESTURE_COMPLETE_EVENT, onGestureComplete);
  }, []);

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), 1400);
    return () => window.clearTimeout(timer);
  }, [hint]);

  return hint;
}
