import { createAction, props } from '@ngrx/store'
import type { ReviewDecision, ReviewStatus, RiskLevel, RoutePackageDto } from '../types'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{ routes: RoutePackageDto[] }>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())
export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())

export const changeSegmentRisk = createAction(
  '[Risk Map] Change Segment Risk',
  props<{ routeId: string; segmentId: string; level: RiskLevel; reason: string }>(),
)
export const reorderSegments = createAction(
  '[Risk Map] Reorder Segments',
  props<{ routeId: string; segmentId: string; direction: -1 | 1; reason: string }>(),
)
export const createAlternative = createAction('[Risk Map] Create Alternative', props<{ routeId: string }>())

export const submitReview = createAction(
  '[Approval] Submit Review',
  props<{
    routeId: string
    segmentId: string
    role: string
    author: string
    decision: ReviewDecision
    content: string
    expectedRevision: number
    reSignOf?: string
  }>(),
)
export const resolveComment = createAction(
  '[Approval] Resolve Comment',
  props<{ id: string; status: Exclude<ReviewStatus, '待确认' | '已失效'> }>(),
)
export const clearConflict = createAction('[Approval] Clear Conflict')

export const lockBaseline = createAction('[Approval] Lock Baseline', props<{ routeId: string }>())
export const applyDraft = createAction('[Approval] Apply Pending Draft', props<{ routeId: string; draftId: string }>())
export const discardDraft = createAction('[Approval] Discard Pending Draft', props<{ routeId: string; draftId: string }>())
