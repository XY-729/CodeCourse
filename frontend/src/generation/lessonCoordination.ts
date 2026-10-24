import type { LessonPlan } from "../platform/android/generationState";

export const CONCURRENT_LESSON_PROMPT_VERSION = "section-coordination-v1";

export function lessonSectionCoordination(sections: LessonPlan["sections"], currentNumber: number): string {
  const lines = ["本课章节分工（来自本次规划；各章正在并发编写，以下不是已生成正文）："];
  sections.forEach((section, index) => {
    lines.push(`第 ${index + 1} 章：${section.title}${index + 1 === currentNumber ? "（当前章，由你编写）" : ""}`);
    section.items.forEach(item => lines.push(`- ${item.name}（类型：${item.kind}；讲解重点：${item.focus || "完整讲清本项，并结合其他章节的分工确定边界"}）`));
  });
  return [...lines, "", "章节协调要求（用于界定本章任务）：",
    "- 先结合全部章节的知识项和讲解重点确定本章边界，只输出当前章正文。",
    "- 其他章节负责详讲的定义、通用机制、基础接口和完整示例，本章只作理解所必需的承接，不重新完整展开；只有确有阅读需要才引用具体位置。",
    "- 以上分工只用于内部协调，正文不逐项通报职责、不列交接点，直接讲本节知识；不要混用整门课程的课号与本课的小节号。",
    "- 同一概念在多个章节出现时，按各章重点递进：保留本章新增的推导、应用、边界条件和必要示例；不能仅因概念同名就省略本章内容。",
    "- 本章各知识项之间也要承接：前面小节已讲清的基础可直接引用，后面小节集中讲新增内容，不从定义重新讲起。",
    "- 本章负责首次讲解的内容仍须完整讲清；必要的前置解释可以保留，不能为避免重复而缩减推导、略去条件或只列结论。",
    "- 这是一份计划，其他章节的具体正文尚不可知；不得虚构其代码、例子、结论或声称它们已经完成。",
    "- 本次是核心正文章节写作，全课公共部分和集中练习、自测由统一整合阶段负责，不在每章重复生成。", ""].join("\n");
}

export function coordinatedLessonInputHash(inputHash: string): string {
  const value = `${inputHash}:${CONCURRENT_LESSON_PROMPT_VERSION}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
