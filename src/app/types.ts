export type RiskLevel = '高' | '中' | '低'
export type ReviewRole = '安全' | '运营' | '应急'
export type CountersignStatus = '有效' | '已失效' | '待复核草案'

export interface RiskSegment {
  id: string
  name: string
  from: string
  to: string
  km: string
  speed: string
  risks: string[]
  level: RiskLevel
  status: '待复核' | '已确认' | '需绕行'
  coordinates: [number, number][]
  /** 区段版本：风险调整或新会签提交时递增，作为乐观锁依据 */
  version: number
  /** 当时风险判定依据，随会签快照留存 */
  riskBasis: string
}

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
  /** 路径版本：路径顺序调整、替代方案生成时递增 */
  version: number
  segments: RiskSegment[]
}

/** 会签当时的区段风险快照（审计依据） */
export interface BasisSnapshot {
  level: RiskLevel
  risks: string[]
  speed: string
  routeVersion: number
  segmentVersion: number
}

export interface Countersign {
  id: string
  routeId: string
  segmentId: string
  segmentName: string
  role: ReviewRole
  author: string
  content: string
  status: CountersignStatus
  /** 当时依据：会签时的风险、限速与版本快照说明 */
  basis: string
  basisSnapshot: BasisSnapshot
  createdAt: string
  invalidatedAt?: string
  /** 失效原因：风险变化导致旧会签依据不成立 */
  invalidationReason?: string
  /** 重新会签后指向的新意见 id */
  supersededBy?: string
  /** 重新会签时指向的旧意见 id */
  supersedes?: string
  /** 草案成因：基线锁定或版本冲突后意见保留 */
  draftReason?: string
}

export type TimelineKind =
  | '会签依据'
  | '失效原因'
  | '重新会签结果'
  | '基线锁定'
  | '草案生成'
  | '版本冲突'
  | '草案批准'
  | '草案驳回'
  | '路径变更'

export interface TimelineEvent {
  id: string
  time: string
  kind: TimelineKind
  title: string
  detail: string
  segmentId?: string
}

export type DraftKind = '风险调整' | '区段顺序' | '替代方案'

export interface DraftChange {
  id: string
  kind: DraftKind
  routeId: string
  segmentId?: string
  description: string
  reason: string
  createdAt: string
  author: string
  status: '待复核' | '已批准' | '已驳回'
  payload: Record<string, unknown>
}
