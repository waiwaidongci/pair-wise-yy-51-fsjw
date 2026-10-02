import { inject, Injectable } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { catchError, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs'
import { RouteApiService } from '../services/route-api.service'
import type { RoutePackage } from '../types'
import type { RouteState } from './route.reducer'
import * as RouteActions from './route.actions'

@Injectable()
export class RouteEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(RouteApiService)
  private readonly store = inject(Store<{ routes: RouteState }>)

  loadRoutes$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadRoutes),
    switchMap(() => this.api.getRoutePackages().pipe(
      map((routes) => RouteActions.loadRoutesSuccess({ routes })),
      catchError((error: unknown) => of(RouteActions.loadRoutesFailure({ error: error instanceof Error ? error.message : '无法读取路径数据' }))),
    )),
  ))

  /**
   * 演示两人几乎同时提交同一区段：
   * 两份意见携带相同的区段版本，先到的被接纳（区段版本 +1），
   * 后到的因版本变化被拒绝覆盖、原意见保留为待复核草案。
   */
  simulateConcurrentSubmit$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.simulateConcurrentSubmit),
    withLatestFrom(this.store.select('routes')),
    mergeMap(([action, feature]) => {
      const state: RouteState = feature
      let route: RoutePackage | undefined
      let segmentId: string = action.segmentId ?? ''
      if (segmentId) {
        route = state.routes.find((item: RoutePackage) => item.segments.some((segment) => segment.id === segmentId))
      } else {
        route = state.routes.find((item: RoutePackage) => item.id === state.selectedRouteId)
        segmentId = state.selectedSegmentId || (route?.segments[0]?.id ?? '')
      }
      const segment = route?.segments.find((item: RoutePackage['segments'][number]) => item.id === segmentId)
      if (!route || !segment) return of()
      const expectedVersion = segment.version
      return of(
        RouteActions.submitCountersign({
          routeId: route.id,
          segmentId: segment.id,
          role: '安全',
          author: '先到审阅人',
          content: `经复核，${segment.name} 按现行风险等级与限速要求落实管控措施，同意会签。`,
          expectedVersion,
        }),
        RouteActions.submitCountersign({
          routeId: route.id,
          segmentId: segment.id,
          role: '安全',
          author: '后到审阅人',
          content: `同一区段补充现场监护与吸附物资要求（后到意见，保留为待复核草案）。`,
          expectedVersion,
        }),
      )
    }),
  ))
}
