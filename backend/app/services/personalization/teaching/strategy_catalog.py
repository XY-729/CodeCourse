from __future__ import annotations

from app.services.personalization.teaching.teaching_plan_schema import TeachingStrategyId

STRATEGY_LABELS: dict[TeachingStrategyId, str] = {
    "direct_answer": "直接回答",
    "overview_map": "整体架构图",
    "execution_sequence": "执行流程",
    "state_transition": "状态转换",
    "role_comparison": "角色对比",
    "contrast_table": "对比表",
    "minimal_code": "最小代码示例",
    "project_code": "项目实际代码",
    "worked_example": "完整实践示例",
    "analogy": "类比解释",
    "counterexample": "反例说明",
    "error_diagnosis": "错误诊断",
    "boundary_case": "边界条件",
    "progressive_hint": "渐进提示",
    "prerequisite_bridge": "前置知识补充",
    "brief_definition": "简要定义",
    "detailed_derivation": "详细推导",
    "summary_check": "总结检查",
}

STRATEGY_CATALOG: dict[TeachingStrategyId, str] = {
    "direct_answer": "直接回答问题核心，不加额外教学框架",
    "overview_map": "先展示整体结构/架构，再定位具体问题",
    "execution_sequence": "按代码或系统执行顺序逐步讲解",
    "state_transition": "展示系统状态变化过程",
    "role_comparison": "通过对比不同角色的职责帮助理解",
    "contrast_table": "以表格形式对比多个选项/概念",
    "minimal_code": "给出最精简的可运行代码",
    "project_code": "从用户当前项目代码出发讲解",
    "worked_example": "提供一个完整的实践示例",
    "analogy": "用一个熟悉的领域类比解释",
    "counterexample": "通过错误示范说明边界",
    "error_diagnosis": "定位和解释可能的错误原因",
    "boundary_case": "讨论边界条件和限制",
    "progressive_hint": "先给提示，逐步引导用户自己得出答案",
    "prerequisite_bridge": "补充推导所需的前置概念",
    "brief_definition": "给出简洁的术语或概念定义",
    "detailed_derivation": "逐步推导过程和原理",
    "summary_check": "归纳要点并检查理解",
}
