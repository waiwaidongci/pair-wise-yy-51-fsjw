import { createReducer, on } from '@ngrx/store'
import type {
  BasisSnapshot,
  Countersign,
  DraftChange,
  RiskLevel,
  RiskSegment,
  RoutePackage,
  TimelineEvent,
} from '../types'
import * as RouteActions from './route.actions'

export interface RouteState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedSegmentId: string
  countersigns: Countersign[]
  timeline: TimelineEvent[]
  drafts: DraftChange[]
  /** 审计基线锁定后，风险/顺序/替代方案修改仅生成待复核草案 */
  baselineLocked: boolean
  /** 后到提交的版本冲突提示（先到版本已接纳，原意见保留为草案） */
  conflictNotice: string
  loading: boolean
  error: string
  version: number
}

const now = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

let seq = 100
const genId = (prefix: string) => {
  seq += 1
  return `${prefix}-${seq}`
}

const riskBasisOf = (segment: RiskSegment) =>
  `风险等级 ${segment.level}，风险因素：${segment.risks.join('、')}，限速 ${segment.speed}，运行里程 ${segment.km} km`

/** 风险重算：高风险区段越多分越高，用于失效后重算路径风险分 */
const calcScore = (route: RoutePackage) => {
  const high = route.segments.filter((s) => s.level === '高').length
  const mid = route.segments.filter((s) => s.level === '中').length
  return Math.min(100, Math.max(35, 40 + high * 15 + mid * 6))
}

const seedTimeline: TimelineEvent[] = [
  { id: 'TL-1', time: '09:10', kind: '会签依据', title: '运输单进入多角色会签', detail: '安全、运营、应急按区段逐段会签，意见锚定区段版本与当时风险依据，作为审计基线来源。' },
  { id: 'TL-2', time: '09:12', kind: '会签依据', title: '韩洁 提交 S-203 会签意见（安全）', detail: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。' },
  { id: 'TL-3', time: '09:15', kind: '会签依据', title: '罗晋 提交 S-207 会签意见（应急）', detail: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。' },
]

/** 由初始意见构建会签记录（补全当时依据快照） */
function seedCountersigns(routes: RoutePackage[]): Countersign[] {
  const locate = (segmentId: string) => {
    for (const route of routes) {
      const segment = route.segments.find((s) => s.id === segmentId)
      if (segment) return { route, segment }
    }
    return null
  }
  const seeds: Array<Pick<Countersign, 'id' | 'segmentId' | 'role' | 'author' | 'content'> & { minute: string }> = [
    { id: 'RV-31', segmentId: 'S-203', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', minute: '12' },
    { id: 'RV-32', segmentId: 'S-207', role: '应急', author: '罗晋', content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', minute: '15' },
  ]
  return seeds.map((seed) => {
    const located = locate(seed.segmentId)
    const segment = located?.segment
    const route = located?.route
    const snapshot: BasisSnapshot = segment
      ? { level: segment.level, risks: [...segment.risks], speed: segment.speed, routeVersion: route!.version, segmentVersion: segment.version }
      : { level: '高', risks: [], speed: '', routeVersion: 1, segmentVersion: 1 }
    return {
      id: seed.id,
      routeId: route?.id ?? '',
      segmentId: seed.segmentId,
      segmentName: segment?.name ?? seed.segmentId,
      role: seed.role,
      author: seed.author,
      content: seed.content,
      status: '有效',
      basis: segment
        ? `会签依据：${segment.name}（${segment.from}→${segment.to}）${riskBasisOf(segment)}；路径版本 v${route!.version}，区段版本 v${segment.version}。`
        : '初始会签意见（区段数据加载后补全依据）',
      basisSnapshot: snapshot,
      createdAt: `09:${seed.minute}`,
    }
  })
}

function pushEvent(timeline: TimelineEvent[], event: Omit<TimelineEvent, 'id' | 'time'> & { time?: string }): TimelineEvent[] {
  return [{ id: genId('TL'), time: event.time ?? now(), kind: event.kind, title: event.title, detail: event.detail, segmentId: event.segmentId }, ...timeline]
}

/**
 * 区段风险变化的核心处理：
 * - 区段版本 +1、路径版本 +1，重算风险分
 * - 仅失效「同一区段」仍有效的会签（记录失效原因），未受影响区段意见继续有效
 */
function applyRiskChange(
  state: RouteState,
  segmentId: string,
  level: RiskLevel,
  author: string,
  reason: string,
): Pick<RouteState, 'routes' | 'countersigns' | 'timeline'> {
  const timeline = [...state.timeline]
  const beforeRoute = state.routes.find((route) => route.segments.some((segment) => segment.id === segmentId))!
  const oldLevel = beforeRoute.segments.find((segment) => segment.id === segmentId)!.level

  const routes = state.routes.map((route) => ({
    ...route,
    version: route.segments.some((segment) => segment.id === segmentId) ? route.version + 1 : route.version,
    segments: route.segments.map((segment) =>
      segment.id === segmentId
        ? {
            ...segment,
            level,
            version: segment.version + 1,
            status: (level === '高' ? '需绕行' : level === '中' ? '待复核' : '已确认') as RiskSegment['status'],
          }
        : segment,
    ),
  }))

  const afterRoute = routes.find((route) => route.segments.some((segment) => segment.id === segmentId))!
  const afterSegment = afterRoute.segments.find((segment) => segment.id === segmentId)!
  const scoreBefore = beforeRoute.score
  const scoreAfter = calcScore(afterRoute)
  const routesWithScore = routes.map((route) => (route.id === beforeRoute.id ? { ...route, score: scoreAfter } : route))

  const invalidated = state.countersigns.filter((countersign) => countersign.segmentId === segmentId && countersign.status === '有效')
  const countersigns = state.countersigns.map((countersign) =>
    invalidated.includes(countersign)
      ? {
          ...countersign,
          status: '已失效' as const,
          invalidatedAt: now(),
          invalidationReason: `区段风险由「${oldLevel}」调整为「${level}」（${reason}），会签依据已变化，本意见失效；未受影响区段的会签意见继续有效。`,
        }
      : countersign,
  )

  for (const countersign of invalidated) {
    timeline.unshift({
      id: genId('TL'),
      time: now(),
      kind: '失效原因',
      segmentId,
      title: `旧会签 ${countersign.id} 失效（${countersign.role} · ${countersign.author}）`,
      detail: `失效原因：区段风险 ${oldLevel} → ${level}，原会签依据（${countersign.basisSnapshot.level}）已不成立，需重新会签；其他区段意见不受影响、继续有效。`,
    })
  }
  timeline.unshift({
    id: genId('TL'),
    time: now(),
    kind: '会签依据',
    segmentId,
    title: `${afterSegment.name} 风险调整为「${level}」（${author}）`,
    detail: `新依据：${riskBasisOf(afterSegment)}；路径版本 v${beforeRoute.version} → v${afterRoute.version}，风险分 ${scoreBefore} → ${scoreAfter}，相关旧会签已失效并重算。`,
  })

  return { routes: routesWithScore, countersigns, timeline }
}

/** 基线锁定后的修改统一生成待复核草案 */
function makeDraft(
  state: RouteState,
  draft: Omit<DraftChange, 'id' | 'createdAt' | 'status'>,
): { drafts: DraftChange[]; event: TimelineEvent } {
  const created: DraftChange = { ...draft, id: genId('DRAFT'), createdAt: now(), status: '待复核' }
  const event: TimelineEvent = {
    id: genId('TL'),
    time: now(),
    kind: '草案生成',
    segmentId: draft.segmentId,
    title: `待复核草案：${draft.description}`,
    detail: `${draft.reason}；草案编号 ${created.id}，经复核批准后生效并按规则失效相关旧会签。`,
  }
  return { drafts: [created, ...state.drafts], event }
}

export const initialState: RouteState = {
  routes: [],
  selectedRouteId: '',
  selectedSegmentId: '',
  countersigns: [],
  timeline: seedTimeline,
  drafts: [],
  baselineLocked: false,
  conflictNotice: '',
  loading: false,
  error: '',
  version: 6,
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { routes }) => {
    const enriched = routes.map((route) => ({
      ...route,
      version: route.version ?? 1,
      segments: route.segments.map((segment) => ({ ...segment, version: segment.version ?? 1, riskBasis: segment.riskBasis ?? riskBasisOf(segment) })),
    }))
    return {
      ...state,
      loading: false,
      routes: enriched,
      selectedRouteId: state.selectedRouteId || enriched[0]?.id || '',
      selectedSegmentId: state.selectedSegmentId || enriched[0]?.segments[0]?.id || '',
      countersigns: state.countersigns.length ? state.countersigns : seedCountersigns(enriched),
      timeline: state.timeline.length ? state.timeline : seedTimeline,
    }
  }),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(RouteActions.selectRoute, (state, { id }) => ({
    ...state,
    selectedRouteId: id,
    selectedSegmentId: state.routes.find((route) => route.id === id)?.segments[0]?.id ?? '',
  })),
  on(RouteActions.selectSegment, (state, { id }) => ({ ...state, selectedSegmentId: id })),

  on(RouteActions.submitCountersign, (state, { routeId, segmentId, role, author, content, expectedVersion }) => {
    const route = state.routes.find((item) => item.id === routeId)
    const segment = route?.segments.find((item) => item.id === segmentId)
    if (!route || !segment) return state
    const snapshot: BasisSnapshot = {
      level: segment.level,
      risks: [...segment.risks],
      speed: segment.speed,
      routeVersion: route.version,
      segmentVersion: segment.version,
    }
    const basis = `会签依据：${segment.name}（${segment.from}→${segment.to}）${riskBasisOf(segment)}；路径版本 v${route.version}，区段版本 v${segment.version}。`
    const time = now()

    // 基线锁定：只生成待复核草案，不覆盖正式会签记录
    if (state.baselineLocked) {
      const countersign: Countersign = {
        id: genId('RV'), routeId, segmentId, segmentName: segment.name, role, author, content,
        status: '待复核草案', basis, basisSnapshot: snapshot, createdAt: time,
        draftReason: '审计基线已锁定，会签修改仅生成待复核草案，不覆盖正式会签记录。',
      }
      const event: TimelineEvent = {
        id: genId('TL'), time, kind: '草案生成', segmentId,
        title: `会签草案待复核（${role} · ${author}）`,
        detail: countersign.draftReason!,
      }
      return { ...state, countersigns: [countersign, ...state.countersigns], timeline: [event, ...state.timeline] }
    }

    // 乐观锁：后到提交基于已过期的区段版本，先到版本已接纳，原意见保留为草案
    if (segment.version !== expectedVersion) {
      const countersign: Countersign = {
        id: genId('RV'), routeId, segmentId, segmentName: segment.name, role, author, content,
        status: '待复核草案', basis, basisSnapshot: snapshot, createdAt: time,
        draftReason: `版本冲突：提交时区段版本 v${expectedVersion} 已变化为 v${segment.version}，先到意见已接纳；您的原意见保留为待复核草案，未被覆盖。`,
      }
      const event: TimelineEvent = {
        id: genId('TL'), time, kind: '版本冲突', segmentId,
        title: `后到会签意见保留（${role} · ${author}）`,
        detail: `区段版本 v${expectedVersion} → v${segment.version}（先到版本已接纳）；后到意见未覆盖，已保留为待复核草案，可在基线解锁后复核采纳。`,
      }
      return {
        ...state,
        countersigns: [countersign, ...state.countersigns],
        timeline: [event, ...state.timeline],
        conflictNotice: `检测到区段 ${segment.id} 版本已从 v${expectedVersion} 变化为 v${segment.version}，先到意见已接纳；您的意见已保留为待复核草案，原意见未丢失。`,
      }
    }

    const countersign: Countersign = {
      id: genId('RV'), routeId, segmentId, segmentName: segment.name, role, author, content,
      status: '有效', basis, basisSnapshot: snapshot, createdAt: time,
    }
    const event: TimelineEvent = {
      id: genId('TL'), time, kind: '会签依据', segmentId,
      title: `${role}会签提交（${author}）`,
      detail: basis,
    }
    const routes = state.routes.map((item) =>
      item.id === routeId
        ? { ...item, segments: item.segments.map((seg) => (seg.id === segmentId ? { ...seg, version: seg.version + 1 } : seg)) }
        : item,
    )
    return { ...state, routes, countersigns: [countersign, ...state.countersigns], timeline: [event, ...state.timeline], conflictNotice: '' }
  }),

  on(RouteActions.updateSegmentRisk, (state, { segmentId, level, expectedVersion, author }) => {
    const route = state.routes.find((item) => item.segments.some((seg) => seg.id === segmentId))
    const segment = route?.segments.find((item) => item.id === segmentId)
    if (!route || !segment) return state

    if (state.baselineLocked) {
      const { drafts, event } = makeDraft(state, {
        kind: '风险调整', routeId: route.id, segmentId, author,
        description: `${segment.name} 风险等级调整为「${level}」`,
        reason: '审计基线已锁定，风险调整仅生成待复核草案',
        payload: { segmentId, level },
      })
      return { ...state, drafts, timeline: [event, ...state.timeline], conflictNotice: '基线已锁定：本次风险调整已生成待复核草案，批准后生效并按规则失效相关旧会签。' }
    }

    if (segment.version !== expectedVersion) {
      const event: TimelineEvent = {
        id: genId('TL'), time: now(), kind: '版本冲突', segmentId,
        title: `风险调整后到未接纳（${author}）`,
        detail: `区段版本 v${expectedVersion} → v${segment.version}（先到调整已接纳）；后到调整未生效，请基于最新版本重试。`,
      }
      return {
        ...state,
        timeline: [event, ...state.timeline],
        conflictNotice: `区段 ${segment.id} 版本已从 v${expectedVersion} 变化为 v${segment.version}，风险调整未接纳，请基于最新版本重试。`,
      }
    }

    if (segment.level === level) {
      return { ...state, conflictNotice: `区段 ${segment.id} 风险等级未变化（${level}）。` }
    }

    const changed = applyRiskChange(state, segmentId, level, author, '风险复核调整')
    return { ...state, ...changed, conflictNotice: '' }
  }),

  on(RouteActions.reorderSegment, (state, { segmentId, direction, expectedVersion }) => {
    const route = state.routes.find((item) => item.segments.some((seg) => seg.id === segmentId))
    if (!route) return state
    const index = route.segments.findIndex((seg) => seg.id === segmentId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= route.segments.length) return state
    const segment = route.segments[index]

    if (state.baselineLocked) {
      const { drafts, event } = makeDraft(state, {
        kind: '区段顺序', routeId: route.id, segmentId, author: '复核人员',
        description: `${segment.name} 调整至第 ${target + 1} 位`,
        reason: '审计基线已锁定，路径顺序调整仅生成待复核草案',
        payload: { segmentId, direction },
      })
      return { ...state, drafts, timeline: [event, ...state.timeline] }
    }

    if (segment.version !== expectedVersion) {
      return {
        ...state,
        conflictNotice: `区段 ${segment.id} 版本已从 v${expectedVersion} 变化为 v${segment.version}，顺序调整未接纳，请基于最新版本重试。`,
      }
    }

    const segments = [...route.segments]
    ;[segments[index], segments[target]] = [segments[target], segments[index]]
    const routes = state.routes.map((item) => (item.id === route.id ? { ...item, segments, version: item.version + 1 } : item))
    const event: TimelineEvent = {
      id: genId('TL'), time: now(), kind: '路径变更', segmentId,
      title: `路径顺序调整：${segment.name} 移至第 ${target + 1} 位`,
      detail: `路径版本 v${route.version} → v${route.version + 1}；会签意见锚定区段版本，顺序调整不影响区段风险依据，已有意见继续有效。`,
    }
    return { ...state, routes, timeline: [event, ...state.timeline], conflictNotice: '' }
  }),

  on(RouteActions.createAlternative, (state) => {
    const route = state.routes.find((item) => item.id === state.selectedRouteId) ?? state.routes[0]
    if (!route) return state

    if (state.baselineLocked) {
      const { drafts, event } = makeDraft(state, {
        kind: '替代方案', routeId: route.id, author: '复核人员',
        description: `为 ${route.id} 生成替代路径方案`,
        reason: '审计基线已锁定，替代方案修改仅生成待复核草案',
        payload: {},
      })
      return { ...state, drafts, timeline: [event, ...state.timeline] }
    }

    const alternativeId = `${route.id}-ALT`
    const scoreBefore = route.score
    const scoreAfter = Math.max(72, route.score - 2)
    const routes = state.routes.map((item) =>
      item.id === route.id ? { ...item, id: alternativeId, score: scoreAfter, version: item.version + 1 } : item,
    )
    const event: TimelineEvent = {
      id: genId('TL'), time: now(), kind: '路径变更',
      title: `生成替代方案 ${alternativeId}`,
      detail: `路径版本升级，风险分 ${scoreBefore} → ${scoreAfter}；既有区段会签意见继续有效，替代方案需重新会签。`,
    }
    return { ...state, routes, timeline: [event, ...state.timeline] }
  }),

  on(RouteActions.lockBaseline, (state) => {
    if (state.baselineLocked) return state
    const event: TimelineEvent = {
      id: genId('TL'),
      time: now(),
      kind: '基线锁定',
      title: '审计基线锁定',
      detail: '会签依据、失效原因与重新会签结果进入只读审计；锁定后区段风险、路径顺序与替代方案修改仅生成待复核草案，不改动正式记录。',
    }
    return { ...state, baselineLocked: true, timeline: [event, ...state.timeline] }
  }),

  on(RouteActions.resignCountersign, (state, { countersignId, content, author }) => {
    const old = state.countersigns.find((item) => item.id === countersignId)
    if (!old) return state
    const route = state.routes.find((item) => item.id === old.routeId)
    const segment = route?.segments.find((item) => item.id === old.segmentId)
    if (!route || !segment) return state

    const snapshot: BasisSnapshot = {
      level: segment.level,
      risks: [...segment.risks],
      speed: segment.speed,
      routeVersion: route.version,
      segmentVersion: segment.version,
    }
    const basis = `重新会签依据：${segment.name}（${segment.from}→${segment.to}）${riskBasisOf(segment)}；路径版本 v${route.version}，区段版本 v${segment.version}。`
    const replacement: Countersign = {
      id: genId('RV'),
      routeId: route.id,
      segmentId: segment.id,
      segmentName: segment.name,
      role: old.role,
      author,
      content,
      status: '有效',
      basis,
      basisSnapshot: snapshot,
      createdAt: now(),
      supersedes: old.id,
    }
    const countersigns = state.countersigns.map((item) => (item.id === old.id ? { ...item, supersededBy: replacement.id } : item))
    const routes = state.routes.map((item) =>
      item.id === route.id
        ? { ...item, segments: item.segments.map((seg) => (seg.id === segment.id ? { ...seg, version: seg.version + 1, status: '已确认' as RiskSegment['status'] } : seg)) }
        : item,
    )
    const event: TimelineEvent = {
      id: genId('TL'),
      time: now(),
      kind: '重新会签结果',
      segmentId: segment.id,
      title: `重新会签通过（${old.role} · ${author}）`,
      detail: `失效意见 ${old.id} 已由新意见 ${replacement.id} 重新会签闭环；新依据：${basis}`,
    }
    return { ...state, routes, countersigns: [replacement, ...countersigns], timeline: [event, ...state.timeline] }
  }),

  on(RouteActions.approveDraft, (state, { id }) => {
    const draft = state.drafts.find((item) => item.id === id)
    if (!draft || draft.status !== '待复核') return state
    let next: RouteState = state

    if (draft.kind === '风险调整') {
      const { segmentId, level } = draft.payload as { segmentId: string; level: RiskLevel }
      const changed = applyRiskChange(next, segmentId, level, draft.author, `草案 ${draft.id} 批准应用`)
      next = { ...next, ...changed }
    } else if (draft.kind === '区段顺序') {
      const { segmentId, direction } = draft.payload as { segmentId: string; direction: -1 | 1 }
      const route = next.routes.find((item) => item.segments.some((seg) => seg.id === segmentId))
      if (route) {
        const index = route.segments.findIndex((seg) => seg.id === segmentId)
        const target = index + direction
        if (index >= 0 && target >= 0 && target < route.segments.length) {
          const segments = [...route.segments]
          ;[segments[index], segments[target]] = [segments[target], segments[index]]
          next = { ...next, routes: next.routes.map((item) => (item.id === route.id ? { ...item, segments, version: item.version + 1 } : item)) }
        }
      }
    } else if (draft.kind === '替代方案') {
      const route = next.routes.find((item) => item.id === draft.routeId)
      if (route) {
        next = {
          ...next,
          routes: next.routes.map((item) =>
            item.id === route.id ? { ...item, id: `${route.id}-ALT`, score: Math.max(72, route.score - 2), version: item.version + 1 } : item,
          ),
        }
      }
    }

    const drafts = next.drafts.map((item) => (item.id === id ? { ...item, status: '已批准' as const } : item))
    const event: TimelineEvent = {
      id: genId('TL'),
      time: now(),
      kind: '草案批准',
      segmentId: draft.segmentId,
      title: `待复核草案已批准（${draft.description}）`,
      detail: `草案 ${draft.id} 经复核批准并已生效；${draft.kind === '风险调整' ? '相关旧会签已按规则失效，需重新会签。' : '区段会签意见继续有效。'}`,
    }
    return { ...next, drafts, timeline: [event, ...next.timeline] }
  }),

  on(RouteActions.rejectDraft, (state, { id }) => {
    const draft = state.drafts.find((item) => item.id === id)
    if (!draft) return state
    const event: TimelineEvent = {
      id: genId('TL'),
      time: now(),
      kind: '草案驳回',
      segmentId: draft.segmentId,
      title: `待复核草案已驳回（${draft.description}）`,
      detail: `草案 ${draft.id} 经复核驳回，不产生正式变更，正式会签与审计基线保持不变。`,
    }
    return {
      ...state,
      drafts: state.drafts.map((item) => (item.id === id ? { ...item, status: '已驳回' as const } : item)),
      timeline: [event, ...state.timeline],
    }
  }),

  on(RouteActions.clearConflictNotice, (state) => ({ ...state, conflictNotice: '' })),
)
