export type RiskLevel = '高' | '中' | '低'

export type SegmentStatus = '待复核' | '已确认' | '需绕行'

export interface RiskSegment {
  id: string
  name: string
  from: string
  to: string
  km: string
  speed: string
  risks: string[]
  level: RiskLevel
  status: SegmentStatus
  coordinates: [number, number][]
  order: number
  /** 区段会签版本：任意提交、定稿或风险/路径变化都会递增，用于并发提交检测。 */
  revision: number
  /** 区段风险依据版本：仅风险、顺序或替代方案落版时递增，用于判断旧会签是否失效。 */
  riskRevision: number
}

export type RiskSegmentDto = Omit<RiskSegment, 'order' | 'revision' | 'riskRevision'>

export interface RoutePackage {
  id: string
  cargo: string
  hazardClass: string
  trainCode: string
  origin: string
  destination: string
  tonnage: number
  wagonCount: number
  permit: string
  permission: '有效' | '缺失' | '待补充'
  score: number
  updatedAt: string
  revision: number
  locked: boolean
  lockedAt: string
  baselineRevision: number
  baselineSnapshot?: RoutePackage
  pendingDraft?: PendingChange
  segments: RiskSegment[]
}

export type RoutePackageDto = Omit<RoutePackage, 'segments' | 'revision' | 'locked' | 'lockedAt' | 'baselineRevision' | 'baselineSnapshot' | 'pendingDraft'> & {
  segments: RiskSegmentDto[]
}

export type DraftKind = 'risk' | 'order' | 'alternative'

export interface PendingChange {
  id: string
  kind: DraftKind
  summary: string
  detail: string
  createdAt: string
  basisRouteRevision: number
  affectedSegmentIds: string[]
  segmentId?: string
  level?: RiskLevel
  fromIndex?: number
  toIndex?: number
  nextScore: number
}

export type ReviewStatus = '待确认' | '已接受' | '已退回' | '已失效'
export type ReviewDecision = '同意' | '有条件同意' | '退回'

export interface ReviewComment {
  id: string
  routeId: string
  segmentId: string
  role: string
  author: string
  content: string
  status: ReviewStatus
  decision: ReviewDecision
  /** 提交时校验的区段会签版本。 */
  basisRevision: number
  /** 提交时依据的风险/路径版本。 */
  basisRiskRevision: number
  submittedAt: string
  invalidatedAt: string
  invalidReason: string
  reSignOf?: string
  supersededBy?: string
}

export type TimelineCategory = '基线' | '风险' | '顺序' | '替代方案' | '会签' | '冲突' | '草案'

export interface TimelineEvent {
  id: string
  routeId: string
  segmentId?: string
  category: TimelineCategory
  at: string
  title: string
  basis: string
  reason: string
  result: string
  refs: string[]
}

export interface ReviewConflict {
  routeId: string
  segmentId: string
  role: string
  author: string
  content: string
  expectedRevision: number
  actualRevision: number
  at: string
}
