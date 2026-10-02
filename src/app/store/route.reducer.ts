import { createReducer, on } from '@ngrx/store'
import type { ReviewComment, RoutePackage, TimelineEvent } from '../types'
import * as RouteActions from './route.actions'
import {
  cloneRoute,
  draftDescription,
  findRoute,
  findSegment,
  levelStatus,
  makeDraft,
  makeEvent,
  nextId,
  normalizeRoute,
  scoreWithLevel,
  timestamp,
} from './route.helpers'

export interface RouteState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedSegmentId: string
  comments: ReviewComment[]
  timeline: TimelineEvent[]
  conflict: import('../types').ReviewConflict | null
  loading: boolean
  error: string
  version: number
}

export const initialState: RouteState = {
  routes: [],
  selectedRouteId: '',
  selectedSegmentId: '',
  comments: [],
  timeline: [],
  conflict: null,
  loading: false,
  error: '',
  version: 1,
}

function seedReviewData(routes: RoutePackage[]) {
  const primary = routes[0]
  if (!primary) return { comments: [] as ReviewComment[], timeline: [] as TimelineEvent[], routes }

  primary.revision = 3
  const waterSegment = primary.segments.find((segment) => segment.id === 'S-203')
  const tunnelSegment = primary.segments.find((segment) => segment.id === 'S-207')
  if (waterSegment) {
    waterSegment.revision = 2
    waterSegment.riskRevision = 2
  }
  if (tunnelSegment) tunnelSegment.revision = 2

  const comments: ReviewComment[] = [
    {
      id: 'RV-31',
      routeId: primary.id,
      segmentId: 'S-203',
      role: '安全',
      author: '韩洁',
      content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。',
      status: '待确认',
      decision: '有条件同意',
      basisRevision: 2,
      basisRiskRevision: 2,
      submittedAt: '今天 16:42',
      invalidatedAt: '',
      invalidReason: '',
      reSignOf: 'RV-29',
    },
    {
      id: 'RV-29',
      routeId: primary.id,
      segmentId: 'S-203',
      role: '安全',
      author: '韩洁',
      content: '按原中等风险控制：限速 60 km/h，入口确认防护物资即可。',
      status: '已失效',
      decision: '有条件同意',
      basisRevision: 1,
      basisRiskRevision: 1,
      submittedAt: '今天 15:36',
      invalidatedAt: '今天 16:30',
      invalidReason: '西峡水源保护区段风险由「中」调整为「高」，原会签依据已变化。',
      supersededBy: 'RV-31',
    },
    {
      id: 'RV-32',
      routeId: primary.id,
      segmentId: 'S-207',
      role: '应急',
      author: '罗晋',
      content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。',
      status: '已接受',
      decision: '有条件同意',
      basisRevision: 2,
      basisRiskRevision: 1,
      submittedAt: '今天 16:18',
      invalidatedAt: '',
      invalidReason: '',
    },
  ]

  const timeline: TimelineEvent[] = [
    {
      id: 'EV-SEED-4',
      routeId: primary.id,
      segmentId: 'S-203',
      category: '会签',
      at: '今天 16:42',
      title: '韩洁基于新高风险依据重新会签',
      basis: '风险 v2 / 会签 r2',
      reason: '旧意见 RV-29 已失效，需重新确认防护条件',
      result: '形成 RV-31，待安全负责人最终接受；原意见仍可追溯',
      refs: ['RV-31', 'RV-29'],
    },
    {
      id: 'EV-SEED-3',
      routeId: primary.id,
      segmentId: 'S-203',
      category: '风险',
      at: '今天 16:30',
      title: 'S-203 风险等级由中调整为高',
      basis: '修改前：风险 v1 / 会签 r1',
      reason: '新增水源地应急拦截距离不足的气象与地形复核结论',
      result: 'RV-29 自动失效；S-207 等未受影响区段意见继续有效',
      refs: ['RV-29'],
    },
    {
      id: 'EV-SEED-2',
      routeId: primary.id,
      segmentId: 'S-207',
      category: '会签',
      at: '今天 16:18',
      title: '罗晋接受隧道出口监护条件',
      basis: '风险 v1 / 会签 r2',
      reason: '应急专业补充 15 分钟现场监护窗口',
      result: 'RV-32 已接受并签章',
      refs: ['RV-32'],
    },
    {
      id: 'EV-SEED-1',
      routeId: primary.id,
      category: '替代方案',
      at: '今天 15:50',
      title: '系统生成替代路径 R-ALT-02',
      basis: '原路径风险分 78',
      reason: 'S-203 触发高风险绕行比较',
      result: '替代方案风险分 71，待安全与运营共同复核',
      refs: ['R-ALT-02'],
    },
  ]

  return { comments, timeline, routes }
}

function invalidateComments(
  comments: ReviewComment[],
  routeId: string,
  affectedSegmentIds: string[],
  reason: string,
): ReviewComment[] {
  const affected = new Set(affectedSegmentIds)
  return comments.map((comment) => {
    if (comment.routeId !== routeId || !affected.has(comment.segmentId) || comment.status === '已失效') return comment
    return { ...comment, status: '已失效', invalidatedAt: timestamp(), invalidReason: reason }
  })
}

function applyRiskChange(route: RoutePackage, segmentId: string, level: import('../types').RiskLevel) {
  const segment = findSegment(route, segmentId)
  if (!segment) return route
  const nextScore = scoreWithLevel(route.score, segment.level, level)
  return {
    ...route,
    score: nextScore,
    updatedAt: timestamp(),
    revision: route.revision + 1,
    segments: route.segments.map((item) => item.id === segmentId ? {
      ...item,
      level,
      status: levelStatus(level),
      order: item.order,
      revision: item.revision + 1,
      riskRevision: item.riskRevision + 1,
    } : item),
  }
}

function applyOrderChange(route: RoutePackage, segmentId: string, direction: -1 | 1): RoutePackage | null {
  const index = route.segments.findIndex((segment) => segment.id === segmentId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= route.segments.length) return null
  const segments = [...route.segments]
  const [moved] = segments.splice(index, 1)
  segments.splice(target, 0, moved)
  const start = Math.min(index, target)
  const end = Math.max(index, target)
  const affectedIds = route.segments.slice(start, end + 1).map((segment) => segment.id)
  const affected = new Set(affectedIds)
  return {
    ...route,
    updatedAt: timestamp(),
    revision: route.revision + 1,
    segments: segments.map((segment, orderIndex) => ({
      ...segment,
      order: orderIndex + 1,
      revision: segment.revision + (affected.has(segment.id) ? 1 : 0),
      riskRevision: segment.riskRevision + (affected.has(segment.id) ? 1 : 0),
    })),
  }
}

function createAlternativeRoute(route: RoutePackage): RoutePackage {
  const alternative = cloneRoute(route)
  return {
    ...alternative,
    id: `ALT-${route.trainCode}-${nextId('R')}`,
    score: Math.max(72, route.score - 2),
    updatedAt: timestamp(),
    revision: 1,
    locked: false,
    lockedAt: '',
    baselineRevision: 1,
    baselineSnapshot: undefined,
    pendingDraft: undefined,
    segments: alternative.segments.map((segment, index) => ({
      ...segment,
      order: index + 1,
      revision: 1,
      riskRevision: 1,
    })),
  }
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { routes: routeDtos }) => {
    const routes = routeDtos.map(normalizeRoute)
    const seeded = seedReviewData(routes)
    return {
      ...state,
      loading: false,
      routes: seeded.routes,
      comments: seeded.comments,
      timeline: seeded.timeline,
      selectedRouteId: seeded.routes[0]?.id ?? '',
      selectedSegmentId: seeded.routes[0]?.segments[0]?.id ?? '',
      conflict: null,
    }
  }),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(RouteActions.selectRoute, (state, { id }) => {
    const route = findRoute(state.routes, id)
    return { ...state, selectedRouteId: id, selectedSegmentId: route?.segments[0]?.id ?? '' }
  }),
  on(RouteActions.selectSegment, (state, { id }) => ({ ...state, selectedSegmentId: id })),

  on(RouteActions.changeSegmentRisk, (state, { routeId, segmentId, level, reason }) => {
    const route = findRoute(state.routes, routeId)
    const segment = route ? findSegment(route, segmentId) : undefined
    if (!route || !segment || segment.level === level) return state

    if (route.locked) {
      const draft = makeDraft(route, {
        kind: 'risk',
        summary: `锁定后风险修订：${segment.name}`,
        detail: reason,
        affectedSegmentIds: [segmentId],
        segmentId,
        level,
        nextScore: scoreWithLevel(route.score, segment.level, level),
      })
      const event = makeEvent({
        routeId,
        segmentId,
        category: '草案',
        title: `锁定基线后拟将 ${segment.id} 风险调整为「${level}」`,
        basis: `审计基线 r${route.baselineRevision} / 当前 r${route.revision}`,
        reason,
        result: '未改动已锁定依据，仅生成待复核草案；复核通过后才可落版',
        refs: [draft.id],
      })
      return {
        ...state,
        version: state.version + 1,
        routes: state.routes.map((item) => item.id === routeId ? { ...item, pendingDraft: draft } : item),
        timeline: [event, ...state.timeline],
      }
    }

    const changed = applyRiskChange(route, segmentId, level)
    const invalidReason = `${segment.name}风险由「${segment.level}」调整为「${level}」，旧会签依据已变化。`
    const event = makeEvent({
      routeId,
      segmentId,
      category: '风险',
      title: `${segment.id} 风险等级由「${segment.level}」调整为「${level}」`,
      basis: `修改前：风险 v${segment.riskRevision} / 会签 r${segment.revision}`,
      reason,
      result: `相关旧会签自动失效并重算，风险分 ${route.score} → ${changed.score}；其他区段意见保持有效`,
    })
    return {
      ...state,
      version: state.version + 1,
      routes: state.routes.map((item) => item.id === routeId ? changed : item),
      comments: invalidateComments(state.comments, routeId, [segmentId], invalidReason),
      timeline: [event, ...state.timeline],
    }
  }),

  on(RouteActions.reorderSegments, (state, { routeId, segmentId, direction, reason }) => {
    const route = findRoute(state.routes, routeId)
    if (!route) return state
    const index = route.segments.findIndex((segment) => segment.id === segmentId)
    const target = index + direction
    const moved = route.segments[index]
    if (!moved || target < 0 || target >= route.segments.length) return state

    if (route.locked) {
      const affectedIds = route.segments.slice(Math.min(index, target), Math.max(index, target) + 1).map((segment) => segment.id)
      const draft = makeDraft(route, {
        kind: 'order',
        summary: `锁定后顺序修订：${moved.name}`,
        detail: reason,
        affectedSegmentIds: affectedIds,
        segmentId,
        fromIndex: index + 1,
        toIndex: target + 1,
        nextScore: route.score,
      })
      const event = makeEvent({
        routeId,
        segmentId,
        category: '草案',
        title: `锁定基线后拟调整 ${moved.id} 的运行顺序`,
        basis: `审计基线 r${route.baselineRevision} / 当前 r${route.revision}`,
        reason,
        result: '顺序变化只进入待复核草案，原基线路径顺序保持不变',
        refs: [draft.id],
      })
      return {
        ...state,
        version: state.version + 1,
        routes: state.routes.map((item) => item.id === routeId ? { ...item, pendingDraft: draft } : item),
        timeline: [event, ...state.timeline],
      }
    }

    const changed = applyOrderChange(route, segmentId, direction)
    if (!changed) return state
    const affectedIds = route.segments.slice(Math.min(index, target), Math.max(index, target) + 1).map((segment) => segment.id)
    const invalidReason = `${moved.name}路径运行顺序由第 ${index + 1} 位移至第 ${target + 1} 位，运行条件与旧会签锚点已变化。`
    const event = makeEvent({
      routeId,
      segmentId,
      category: '顺序',
      title: `${moved.id} 路径顺序由第 ${index + 1} 位移至第 ${target + 1} 位`,
      basis: `修改前：路径 r${route.revision} / ${moved.id} 会签 r${moved.revision}`,
      reason,
      result: '顺序受影响区段的旧会签失效，未跨越区段继续沿用原意见',
    })
    return {
      ...state,
      version: state.version + 1,
      routes: state.routes.map((item) => item.id === routeId ? changed : item),
      comments: invalidateComments(state.comments, routeId, affectedIds, invalidReason),
      timeline: [event, ...state.timeline],
    }
  }),

  on(RouteActions.createAlternative, (state, { routeId }) => {
    const route = findRoute(state.routes, routeId)
    if (!route) return state

    if (route.locked) {
      const draft = makeDraft(route, {
        kind: 'alternative',
        summary: `锁定后替代方案：${route.trainCode}`,
        detail: '需比较接卸条件、应急救援半径和高风险区段避让效果。',
        affectedSegmentIds: route.segments.map((segment) => segment.id),
        nextScore: Math.max(72, route.score - 2),
      })
      const event = makeEvent({
        routeId,
        category: '草案',
        title: '锁定基线后拟生成替代路径',
        basis: `审计基线 r${route.baselineRevision} / 当前 r${route.revision}`,
        reason: '复核人员要求补充高风险区段绕行方案',
        result: '替代方案仅作为待复核草案保留，未覆盖基线路径',
        refs: [draft.id],
      })
      return {
        ...state,
        version: state.version + 1,
        routes: state.routes.map((item) => item.id === routeId ? { ...item, pendingDraft: draft } : item),
        timeline: [event, ...state.timeline],
      }
    }

    const alternative = createAlternativeRoute(route)
    const insertAt = state.routes.findIndex((item) => item.id === routeId) + 1
    const routes = [...state.routes.slice(0, insertAt), alternative, ...state.routes.slice(insertAt)]
    const event = makeEvent({
      routeId,
      category: '替代方案',
      title: `生成替代路径 ${alternative.id}`,
      basis: `原路径 ${route.id} · 风险分 ${route.score}`,
      reason: '对高风险区段生成可比较的接卸与绕行方案',
      result: `新增候选方案，风险分 ${alternative.score}；原路径及未受影响意见保留`,
      refs: [route.id, alternative.id],
    })
    return {
      ...state,
      version: state.version + 1,
      routes,
      selectedRouteId: alternative.id,
      selectedSegmentId: alternative.segments[0]?.id ?? '',
      timeline: [event, ...state.timeline],
    }
  }),

  on(RouteActions.submitReview, (state, payload) => {
    const route = findRoute(state.routes, payload.routeId)
    const segment = route ? findSegment(route, payload.segmentId) : undefined
    if (!route || !segment) return state

    if (segment.revision !== payload.expectedRevision) {
      const at = timestamp()
      const conflict = {
        routeId: route.id,
        segmentId: segment.id,
        role: payload.role,
        author: payload.author,
        content: payload.content,
        expectedRevision: payload.expectedRevision,
        actualRevision: segment.revision,
        at,
      }
      const event = makeEvent({
        routeId: route.id,
        segmentId: segment.id,
        category: '冲突',
        title: `${payload.author}的后到会签未写入`,
        basis: `提交人持有会签 r${payload.expectedRevision}`,
        reason: `区段已由另一笔先到提交推进到 r${segment.revision}`,
        result: '后到版本被拒绝；原意见文本保留，可基于最新版本重新会签',
      })
      return { ...state, conflict, timeline: [event, ...state.timeline] }
    }

    const id = `RV-${Date.now().toString(36).toUpperCase()}`
    const comment: ReviewComment = {
      id,
      routeId: route.id,
      segmentId: segment.id,
      role: payload.role,
      author: payload.author,
      content: payload.content,
      status: payload.decision === '退回' ? '已退回' : '待确认',
      decision: payload.decision,
      basisRevision: segment.revision,
      basisRiskRevision: segment.riskRevision,
      submittedAt: timestamp(),
      invalidatedAt: '',
      invalidReason: '',
      reSignOf: payload.reSignOf,
    }
    const comments = [
      comment,
      ...state.comments.map((item) => payload.reSignOf && item.id === payload.reSignOf
        ? { ...item, supersededBy: id }
        : item),
    ]
    const event = makeEvent({
      routeId: route.id,
      segmentId: segment.id,
      category: '会签',
      title: `${payload.role} · ${payload.author}提交${payload.reSignOf ? '重新会签' : '区段意见'}`,
      basis: `风险 v${segment.riskRevision} / 会签 r${segment.revision}`,
      reason: payload.reSignOf ? `原意见 ${payload.reSignOf} 依据失效或需替代` : '多角色会签流程',
      result: `已接纳 ${id}，区段会签推进至 r${segment.revision + 1}`,
      refs: payload.reSignOf ? [id, payload.reSignOf] : [id],
    })
    return {
      ...state,
      conflict: null,
      comments,
      timeline: [event, ...state.timeline],
      routes: state.routes.map((item) => item.id === route.id ? {
        ...item,
        segments: item.segments.map((candidate) => candidate.id === segment.id ? {
          ...candidate,
          revision: candidate.revision + 1,
        } : candidate),
      } : item),
    }
  }),

  on(RouteActions.resolveComment, (state, { id, status }) => {
    const target = state.comments.find((comment) => comment.id === id)
    if (!target || target.status === '已失效' || target.status === status) return state
    const route = findRoute(state.routes, target.routeId)
    const segment = route ? findSegment(route, target.segmentId) : undefined
    const event = makeEvent({
      routeId: target.routeId,
      segmentId: target.segmentId,
      category: '会签',
      title: `${target.author}的意见被${status === '已接受' ? '接受' : '退回'}`,
      basis: segment ? `风险 v${target.basisRiskRevision} / 提交时会签 r${target.basisRevision}` : '原始提交版本',
      reason: '会签责任人处理待确认条件',
      result: status === '已接受' ? '条件写入放行约束，区段会签版本继续推进' : '退回补件后需再次提交',
      refs: [id],
    })
    return {
      ...state,
      comments: state.comments.map((comment) => comment.id === id ? { ...comment, status } : comment),
      timeline: [event, ...state.timeline],
      routes: segment && route ? state.routes.map((item) => item.id === route.id ? {
        ...item,
        segments: item.segments.map((candidate) => candidate.id === segment.id ? {
          ...candidate,
          revision: candidate.revision + 1,
        } : candidate),
      } : item) : state.routes,
    }
  }),

  on(RouteActions.clearConflict, (state) => ({ ...state, conflict: null })),

  on(RouteActions.lockBaseline, (state, { routeId }) => {
    const route = findRoute(state.routes, routeId)
    if (!route || route.locked) return state
    const at = timestamp()
    const lockedRoute: RoutePackage = {
      ...route,
      locked: true,
      lockedAt: at,
      baselineRevision: route.revision,
      baselineSnapshot: cloneRoute(route),
      pendingDraft: undefined,
    }
    const event = makeEvent({
      routeId,
      category: '基线',
      title: `审计基线已锁定（r${route.revision}）`,
      basis: `路径 r${route.revision} / 区段风险与全部有效会签`,
      reason: '多角色会签进入可审计基线，后续修订不得覆盖原始依据',
      result: '此后风险、顺序或替代方案修改均生成待复核草案',
      refs: [`BASE-${route.id}`],
    })
    return {
      ...state,
      routes: state.routes.map((item) => item.id === routeId ? lockedRoute : item),
      timeline: [event, ...state.timeline],
    }
  }),

  on(RouteActions.discardDraft, (state, { routeId, draftId }) => {
    const route = findRoute(state.routes, routeId)
    if (!route?.pendingDraft || route.pendingDraft.id !== draftId) return state
    const event = makeEvent({
      routeId,
      category: '草案',
      title: `${route.pendingDraft.summary}已退回`,
      basis: `草案 ${draftId} / 基线 r${route.baselineRevision}`,
      reason: route.pendingDraft.detail,
      result: '草案未落版，锁定基线与原有会签继续有效',
      refs: [draftId],
    })
    return {
      ...state,
      timeline: [event, ...state.timeline],
      routes: state.routes.map((item) => item.id === routeId ? { ...item, pendingDraft: undefined } : item),
    }
  }),

  on(RouteActions.applyDraft, (state, { routeId, draftId }) => {
    const route = findRoute(state.routes, routeId)
    const draft = route?.pendingDraft
    if (!route || !draft || draft.id !== draftId) return state

    if (draft.kind === 'alternative') {
      const alternative = createAlternativeRoute(route)
      const insertAt = state.routes.findIndex((item) => item.id === routeId) + 1
      const routes = [...state.routes.slice(0, insertAt), alternative, ...state.routes.slice(insertAt)]
      const reviewed = makeEvent({
        routeId,
        category: '草案',
        title: '替代方案草案复核通过',
        basis: `草案 ${draft.id} / 基线 r${route.baselineRevision}`,
        reason: draft.detail,
        result: `生成 ${alternative.id}，基线方案仍只读保留`,
        refs: [draft.id, alternative.id],
      })
      const event = makeEvent({
        routeId,
        category: '替代方案',
        title: `替代路径 ${alternative.id} 已形成新版本`,
        basis: `原路径风险分 ${route.score}`,
        reason: '待复核草案经会签后落版',
        result: `新方案风险分 ${alternative.score}，需按新区段重新会签`,
        refs: [route.id, alternative.id],
      })
      return {
        ...state,
        version: state.version + 1,
        routes: routes.map((item) => item.id === routeId ? { ...item, pendingDraft: undefined } : item),
        timeline: [event, reviewed, ...state.timeline],
      }
    }

    let changed: RoutePackage | null = null
    let affectedIds = draft.affectedSegmentIds
    let invalidReason = ''
    let eventCategory: '风险' | '顺序' = '风险'
    let title = ''
    let basis = `草案 ${draft.id} / 基线 r${route.baselineRevision}`
    let reason = draft.detail

    if (draft.kind === 'risk' && draft.segmentId && draft.level) {
      const oldSegment = findSegment(route, draft.segmentId)
      changed = applyRiskChange({ ...route, pendingDraft: undefined }, draft.segmentId, draft.level)
      invalidReason = `草案落版：${oldSegment?.name ?? draft.segmentId}风险调整为「${draft.level}」，原基线会签依据已变化。`
      title = `${draft.segmentId} 风险修订草案已落版`
    } else if (draft.kind === 'order' && draft.segmentId && draft.fromIndex && draft.toIndex) {
      const direction = draft.toIndex > draft.fromIndex ? 1 : -1
      changed = applyOrderChange({ ...route, pendingDraft: undefined }, draft.segmentId, direction)
      affectedIds = draft.affectedSegmentIds
      invalidReason = `草案落版：区段顺序由第 ${draft.fromIndex} 位移至第 ${draft.toIndex} 位，受影响会签需重签。`
      eventCategory = '顺序'
      title = `${draft.segmentId} 路径顺序草案已落版`
    }
    if (!changed) return state

    const reviewed = makeEvent({
      routeId,
      segmentId: draft.segmentId,
      category: '草案',
      title: `${draft.summary}复核通过`,
      basis,
      reason,
      result: '草案从待复核状态落为新版本；锁定基线快照未被覆盖',
      refs: [draft.id],
    })
    const event = makeEvent({
      routeId,
      segmentId: draft.segmentId,
      category: eventCategory,
      title,
      basis: `落版前：当前 r${route.revision} / 基线 r${route.baselineRevision}`,
      reason: draftDescription(draft),
      result: '受影响区段旧会签标记失效，未受影响区段意见继续有效',
      refs: [draft.id, ...affectedIds],
    })
    return {
      ...state,
      version: state.version + 1,
      routes: state.routes.map((item) => item.id === routeId ? changed : item),
      comments: invalidateComments(state.comments, routeId, affectedIds, invalidReason),
      timeline: [event, reviewed, ...state.timeline],
    }
  }),
)
