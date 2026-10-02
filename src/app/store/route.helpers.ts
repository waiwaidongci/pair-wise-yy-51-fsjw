import type {
  DraftKind,
  PendingChange,
  RiskLevel,
  RiskSegment,
  RoutePackage,
  RoutePackageDto,
  SegmentStatus,
  TimelineCategory,
  TimelineEvent,
} from '../types'

let sequence = 0

export function timestamp(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function nextId(prefix: string): string {
  sequence += 1
  return `${prefix}-${Date.now().toString(36)}-${sequence}`
}

export function levelStatus(level: RiskLevel): SegmentStatus {
  if (level === '高') return '需绕行'
  if (level === '中') return '待复核'
  return '已确认'
}

function levelWeight(level: RiskLevel): number {
  return level === '高' ? 28 : level === '中' ? 16 : 6
}

export function scoreWithLevel(score: number, oldLevel: RiskLevel, newLevel: RiskLevel): number {
  return Math.max(0, Math.min(100, score - levelWeight(oldLevel) + levelWeight(newLevel)))
}

export function normalizeRoute(dto: RoutePackageDto): RoutePackage {
  return {
    ...dto,
    revision: 1,
    locked: false,
    lockedAt: '',
    baselineRevision: 1,
    segments: dto.segments.map((segment, index) => ({
      ...segment,
      order: index + 1,
      revision: 1,
      riskRevision: 1,
    })),
  }
}

export function cloneRoute(route: RoutePackage): RoutePackage {
  return structuredClone(route)
}

export function findRoute(routes: RoutePackage[], routeId: string): RoutePackage | undefined {
  return routes.find((route) => route.id === routeId)
}

export function findSegment(route: RoutePackage, segmentId: string): RiskSegment | undefined {
  return route.segments.find((segment) => segment.id === segmentId)
}

export function makeEvent(event: {
  routeId: string
  category: TimelineCategory
  title: string
  basis: string
  reason: string
  result: string
  segmentId?: string
  refs?: string[]
}): TimelineEvent {
  return {
    id: nextId('EV'),
    at: timestamp(),
    refs: [],
    ...event,
  }
}

export function makeDraft(route: RoutePackage, template: {
  kind: DraftKind
  summary: string
  detail: string
  affectedSegmentIds: string[]
  segmentId?: string
  level?: RiskLevel
  fromIndex?: number
  toIndex?: number
  nextScore: number
}): PendingChange {
  return {
    id: nextId('D'),
    createdAt: timestamp(),
    basisRouteRevision: route.revision,
    ...template,
  }
}

export function draftDescription(draft: PendingChange): string {
  if (draft.kind === 'risk') return `风险等级拟调整为「${draft.level}」`
  if (draft.kind === 'order') return `区段顺序拟由第 ${draft.fromIndex} 位移至第 ${draft.toIndex} 位`
  return '拟生成具备接卸条件的替代路径'
}
