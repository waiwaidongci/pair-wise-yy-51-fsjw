import { createAction, props } from '@ngrx/store'
import type { DraftChange, RiskLevel, ReviewRole, RoutePackage } from '../types'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{ routes: RoutePackage[] }>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())

export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())

/** 提交区段会签意见；expectedVersion 为提交方所见的区段版本（乐观锁） */
export const submitCountersign = createAction(
  '[Approval] Submit Countersign',
  props<{ routeId: string; segmentId: string; role: ReviewRole; author: string; content: string; expectedVersion: number }>(),
)

/** 复核人员调整区段风险；任一区段风险变化即重算相关旧会签 */
export const updateSegmentRisk = createAction(
  '[Risk Map] Update Segment Risk',
  props<{ segmentId: string; level: RiskLevel; expectedVersion: number; author: string }>(),
)

/** 复核人员调整区段顺序（路径顺序变更） */
export const reorderSegment = createAction(
  '[Risk Map] Reorder Segment',
  props<{ segmentId: string; direction: -1 | 1; expectedVersion: number }>(),
)

export const createAlternative = createAction('[Risk Map] Create Alternative')

/** 锁定审计基线：此后修改仅生成待复核草案 */
export const lockBaseline = createAction('[Approval] Lock Baseline')

/** 旧会签失效后重新会签，新意见取代旧意见并记录结果 */
export const resignCountersign = createAction(
  '[Approval] Resign Countersign',
  props<{ countersignId: string; content: string; author: string }>(),
)

export const approveDraft = createAction('[Approval] Approve Draft', props<{ id: DraftChange['id'] }>())
export const rejectDraft = createAction('[Approval] Reject Draft', props<{ id: DraftChange['id'] }>())

/** 演示：两人几乎同时提交同一区段，先到接纳、后到版本冲突且意见保留 */
export const simulateConcurrentSubmit = createAction('[Approval] Simulate Concurrent Submit', props<{ segmentId?: string }>())

export const clearConflictNotice = createAction('[Approval] Clear Conflict Notice')
