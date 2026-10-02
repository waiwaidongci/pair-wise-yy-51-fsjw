import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { MatTableModule } from '@angular/material/table'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatSelectModule } from '@angular/material/select'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatDividerModule } from '@angular/material/divider'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import type { RoutePackage } from '../types'

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatProgressBarModule, MatDividerModule],
  template: `
    <main class="page">
      <div class="page-head">
        <div><p class="eyebrow">运输许可与路径编组</p><h1>危险货物运输路径审批</h1><p>核对货物类别、编组、许可与区段约束，候选方案的风险变化按区段驱动会签重算。</p></div>
        <div><button mat-stroked-button [disabled]="!selectedRoute" (click)="createAlternative()">生成替代方案</button> <button mat-flat-button color="primary" (click)="refresh()">重新校验</button></div>
      </div>
      <div class="grid-4">
        <article class="card metric"><span>候选路径</span><strong>{{ routes.length }}</strong><small>含已复核与替代方案</small></article>
        <article class="card metric"><span>高风险区段</span><strong class="risk-high">{{ highRiskCount }}</strong><small>变化即失效区段旧会签</small></article>
        <article class="card metric"><span>待复核草案</span><strong class="risk-mid">{{ draftCount }}</strong><small>锁定基线后不直接落版</small></article>
        <article class="card metric"><span>会签/审计版本</span><strong>v{{ version }}</strong><small>每次接受写入时间线</small></article>
      </div>
      @if (loading) { <mat-progress-bar mode="indeterminate" /> }
      <div class="grid-2">
        <section class="card table-wrap">
          <div class="toolbar"><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>货物类别</mat-label><mat-select><mat-option>全部类别</mat-option><mat-option>第 3 类 易燃液体</mat-option><mat-option>第 8 类 腐蚀品</mat-option></mat-select></mat-form-field><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>审批状态</mat-label><mat-select><mat-option>全部状态</mat-option><mat-option>待安全复核</mat-option><mat-option>待应急复核</mat-option></mat-select></mat-form-field><span class="spacer"></span><button mat-stroked-button>导出审批包</button></div>
          <table mat-table [dataSource]="routes">
            <ng-container matColumnDef="id"><th mat-header-cell *matHeaderCellDef>运输单 / 版本</th><td mat-cell *matCellDef="let row"><b>{{row.id}}</b><small class="block">{{row.updatedAt}} · r{{row.revision}}</small></td></ng-container>
            <ng-container matColumnDef="cargo"><th mat-header-cell *matHeaderCellDef>货物 / 车次</th><td mat-cell *matCellDef="let row"><b>{{row.cargo}}</b><small class="block">{{row.hazardClass}} · {{row.trainCode}}</small></td></ng-container>
            <ng-container matColumnDef="route"><th mat-header-cell *matHeaderCellDef>起终点</th><td mat-cell *matCellDef="let row">{{row.origin}} → {{row.destination}}<small class="block">{{row.segments.length}} 个区段</small></td></ng-container>
            <ng-container matColumnDef="permission"><th mat-header-cell *matHeaderCellDef>许可 / 基线</th><td mat-cell *matCellDef="let row"><span [class.risk-high]="row.permission!=='有效'">{{row.permission}}</span><small class="block">{{row.locked ? '基线 r'+row.baselineRevision+' 已锁定' : '未锁定'}}</small></td></ng-container>
            <ng-container matColumnDef="score"><th mat-header-cell *matHeaderCellDef>风险分</th><td mat-cell *matCellDef="let row"><b [class.risk-high]="row.score>=70" [class.risk-mid]="row.score>=45 && row.score<70">{{row.score}}</b> / 100<small class="block" [class.risk-mid]="!!row.pendingDraft">{{row.pendingDraft ? '有待复核草案' : '可会签'}}</small></td></ng-container>
            <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let row"><button mat-button color="primary" (click)="select(row)">审核</button></td></ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns" [class.selected-row]="row.id === selectedId"></tr>
          </table>
        </section>
        <aside class="card">
          <h2>会签重算规则</h2>
          @for (route of routes; track route.id) {
            <div class="rule" [class.active]="route.id === selectedId"><div><b>{{route.trainCode}} · {{route.id}}</b><span>{{route.segments.length}} 个运行区段 · {{route.locked ? '基线锁定' : '当前版本'}}</span></div><strong [class.risk-high]="route.score >= 70" [class.risk-mid]="route.score < 70">{{route.score >= 70 ? '高风险' : '需复核' }}</strong></div>
          }
          <mat-divider />
          <h3>系统保证</h3>
          <p>✓ 只失效风险或顺序受影响区段，其他意见继续有效</p>
          <p>✓ 并发提交以会签 revision 比较，后到版本不覆盖先到版本</p>
          <p>✓ 审计基线锁定后，风险、顺序和替代方案均生成待复核草案</p>
          <p class="risk-mid">! 时间线区分当时依据、失效原因、重新会签与落版结果</p>
          <button mat-flat-button color="primary" style="width:100%" [disabled]="!selectedRoute" (click)="createAlternative()">要求补充替代方案</button>
        </aside>
      </div>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 12px}.table-wrap{overflow:auto}.block{display:block;color:#7a8798;margin-top:3px}.selected-row{background:#eff6ff}.rule{display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid #edf0f5}.rule span{display:block;color:#7a8798;font-size:12px;margin-top:4px}.rule.active{padding-left:10px;border-left:3px solid #2563eb}.rule strong{font-size:12px}.toolbar{margin-bottom:10px}.toolbar mat-form-field{width:160px}
  `],
})
export class WorkspaceComponent implements OnInit {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  readonly columns = ['id', 'cargo', 'route', 'permission', 'score', 'action']
  routes: RoutePackage[] = []
  selectedId = ''
  selectedRoute?: RoutePackage
  highRiskCount = 0
  draftCount = 0
  version = 1
  loading = false

  constructor() {
    this.state$.subscribe((state: RouteState) => {
      this.routes = state.routes
      this.selectedId = state.selectedRouteId
      this.selectedRoute = state.routes.find((route) => route.id === state.selectedRouteId)
      this.highRiskCount = state.routes.flatMap((route) => route.segments).filter((segment) => segment.level === '高').length
      this.draftCount = state.routes.filter((route) => route.pendingDraft).length
      this.version = state.version
      this.loading = state.loading
    })
  }
  ngOnInit() { this.refresh() }
  refresh() { this.store.dispatch(RouteActions.loadRoutes()) }
  select(row: RoutePackage) { this.store.dispatch(RouteActions.selectRoute({ id: row.id })) }
  createAlternative() { if (this.selectedRoute) this.store.dispatch(RouteActions.createAlternative({ routeId: this.selectedRoute.id })) }
}
