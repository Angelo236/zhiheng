import {
  durationMinutes,
  hitsSleep,
  rangesOverlap,
  weekRange,
  type Block,
  type Checks,
  type Scene,
  type Settings,
} from "@zhiheng/shared";
import type { DB } from "./db.js";
import { getSetting, listBlocks } from "./db.js";

export function capMinutes(settings: Settings, scene: Scene): number {
  if (scene === "学习") return settings.studyCap * 60;
  if (scene === "工作") return settings.workCap * 60;
  return settings.lifeCap * 60;
}

export function usedMinutes(db: DB, scene: Scene | "运动", day: string, ignoreId?: string): number {
  const { start, end } = weekRange(day);
  return listBlocks(db, start, end)
    .filter((block) => block.id !== ignoreId && block.status === "scheduled")
    .filter((block) => (scene === "运动" ? block.exercise : block.scene === scene))
    .reduce((sum, block) => sum + durationMinutes(block.start, block.end), 0);
}

export function evaluateBlock(
  db: DB,
  settings: Settings,
  block: Pick<Block, "day" | "start" | "end" | "scene" | "id">,
): Checks {
  const scene = block.scene === "睡眠" ? "生活" : block.scene;
  const used = usedMinutes(db, scene, block.day, block.id);
  const next = used + durationMinutes(block.start, block.end);
  const cap = capMinutes(settings, scene);
  const others = listBlocks(db).filter(
    (item) => item.day === block.day && item.id !== block.id && item.status !== "window" && item.scene !== "睡眠",
  );
  const clash = others.find((item) => rangesOverlap(block.start, block.end, item.start, item.end));
  const sleep =
    block.scene !== "睡眠" &&
    block.scene !== "生活" &&
    hitsSleep(block.start, block.end, settings.sleepStart, settings.sleepEnd);
  return {
    budget: next <= cap ? "通过" : `超出${scene}每周上限`,
    overlap: clash ? `与${clash.title}重叠` : "通过",
    sleep: sleep ? "进入睡眠时段" : "通过",
  };
}

export function checksPass(checks: Checks): boolean {
  return checks.budget === "通过" && checks.overlap === "通过" && checks.sleep === "通过";
}

export function exerciseNote(db: DB, day: string): string {
  const target = Number(getSetting(db, "exercise_target", "3"));
  const used = usedMinutes(db, "运动", day) / 60;
  const gap = Math.max(0, target - used);
  const usedText = Number.isInteger(used) ? String(used) : used.toFixed(1);
  return gap === 0 ? `运动 ${usedText}/${target} 小时` : `运动 ${usedText}/${target} 小时，还差 ${gap.toFixed(gap % 1 === 0 ? 0 : 1)} 小时`;
}

export function sceneHours(db: DB, settings: Settings, day: string) {
  return (["学习", "生活", "工作"] as const).map((scene) => {
    const used = usedMinutes(db, scene, day) / 60;
    const cap = scene === "学习" ? settings.studyCap : scene === "生活" ? settings.lifeCap : settings.workCap;
    return {
      scene,
      usedHours: Math.round(used * 10) / 10,
      capHours: cap,
    };
  });
}
