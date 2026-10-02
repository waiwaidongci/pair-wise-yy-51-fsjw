import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTabsModule } from '@angular/material/tabs'
import { MatChipsModule } from '@angular/material/chips'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import type { ReviewComment, ReviewDecision, RiskSegment, RoutePackage, TimelineEvent } from '../types'

@Component({
  selector: 'app-approval',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule, MatChipsModule],
  template: `
    <main class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">安全 · 运营 · 应急会签</p>
          <h1>逐区段审批、失效重签与审计基线</h1>
          <p>意见锚定会签版本；风险或顺序变化只失效受影响区段，旧记录、失效原因和重签结果完整保留。</p>
        </div>
        <button mat-flat-button color="primary" [disabled]="!route || route.locked" (click)="lockBaseline()">
          {{ route?.locked ? '基线已锁定 r' + route?.baselineRevision : '确认并锁定基线' }}
        </button>
      </div>

      <div class="toolbar card baseline-bar">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>运输单 / 候选方案</mat-label>
          <mat-select [(ngModel)]="selectedRouteId" (ngModelChange)="selectRoute($event)">
            @for (item of routes; track item.id) {
              <mat-option [value]="item.id">{{item.id}} · {{item.trainCode}} · r{{item.revision}}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <div class="baseline-meta">
          <b>{{route?.id}}</b>
          <span>{{route?.cargo}} · {{route?.origin}} → {{route?.destination}}</span>
          @if (route; as currentRoute) {
        @if (currentRoute.locked) {
          <mat-chip highlighted>审计基线 r{{currentRoute.baselineRevision}} · {{currentRoute.lockedAt}} 锁定</mat-chip>
        } @else {
          <mat-chip>当前可会签版本 r{{currentRoute.revision}}</mat-chip>
        }
      }
        </div>
      </div>

      @if (route?.pendingDraft; as draft) {
        <section class="card draft-card">
          <div>
            <p class="eyebrow">锁定后的待复核草案</p>
            <h2>{{draft.summary}}</h2>
            <p>{{draft.detail}}</p>
            <small>草案 {{draft.id}} · 建立于 {{draft.createdAt}} · 依据基线 r{{draft.basisRouteRevision}}</small>
          </div>
          <div class="draft-actions">
            <button mat-stroked-button color="warn" (click)="discardDraft()">退回草案</button>
            <button mat-flat-button color="primary" (click)="applyDraft()">复核通过并落版</button>
          </div>
        </section>
      }

      @if (conflict && conflict.routeId === selectedRouteId) {
        <section class="card conflict-card">
          <p class="eyebrow">并发版本冲突</p>
          <h2>后到提交已被拒绝，原意见未覆盖</h2>
          <p>{{conflict.author}}（{{conflict.role}}）打开时为 r{{conflict.expectedRevision}}，提交时 {{conflict.segmentId}} 已变为 r{{conflict.actualRevision}}。以下原意见已保留，可核对后重新会签。</p>
          <blockquote>{{conflict.content}}</blockquote>
          <div class="actions"><button mat-stroked-button (click)="dismissConflict()">知道了</button><button mat-flat-button color="primary" (click)="restoreConflict()">恢复为我的意见</button></div>
        </section>
      }

      <mat-tab-group>
        <mat-tab [label]="'区段会签（' + comments.length + '）'">
          <section class="card comment-list">
            @for (comment of comments; track comment.id) {
              <article class="comment" [class.invalid]="comment.status==='已失效'">
                <div class="comment-head">
                  <div>
                    <b>{{comment.role}} · {{comment.author}}</b>
                    <small>{{comment.segmentId}} · {{comment.id}} · {{comment.submittedAt}}</small>
                  </div>
                  <span class="status {{statusClass(comment.status)}}">{{comment.status}}</span>
                </div>
                <p>{{comment.content}}</p>
                <dl>
                  <div><dt>当时依据</dt><dd>风险 v{{comment.basisRiskRevision}} / 会签 r{{comment.basisRevision}}</dd></div>
                  <div><dt>决定</dt><dd>{{comment.decision}}</dd></div>
                  @if (comment.invalidReason) { <div><dt>失效原因</dt><dd>{{comment.invalidReason}} · {{comment.invalidatedAt}}</dd></div> }
                  @if (comment.reSignOf) { <div><dt>重新会签</dt><dd>承接 {{comment.reSignOf}}<ng-container *ngIf="comment.supersededBy">；已由 {{comment.supersededBy}} 接续</ng-container></dd></div> }
                </dl>
                @if (comment.status === '待确认') {
                  <div class="actions">
                    <button mat-stroked-button color="warn" (click)="resolve(comment.id,'已退回')">退回补件</button>
                    <button mat-flat-button color="primary" (click)="resolve(comment.id,'已接受')">接受条件</button>
                  </div>
                }
                @if (comment.status === '已失效') {
                  <button mat-stroked-button (click)="resign(comment)">基于当前版本重新会签</button>
                }
              </article>
            } @empty { <div class="empty">该候选方案暂无区段意见。</div> }
          </section>
        </mat-tab>

        <mat-tab label="发表区段意见">
          <section class="card form-card">
            @if (reSignOf) { <div class="resign-banner">正在基于已失效意见 {{reSignOf}} 重新会签；提交后旧记录不会被覆盖。</div> }
            <div class="two">
              <mat-form-field>
                <mat-label>专业角色</mat-label>
                <mat-select [(ngModel)]="role"><mat-option>安全</mat-option><mat-option>运营</mat-option><mat-option>应急</mat-option></mat-select>
              </mat-form-field>
              <mat-form-field>
                <mat-label>会签人</mat-label>
                <mat-select [(ngModel)]="author">
                  <mat-option value="当前审阅人">当前审阅人</mat-option><mat-option value="韩洁">韩洁（安全）</mat-option><mat-option value="罗晋">罗晋（应急）</mat-option><mat-option value="周岚">周岚（运营）</mat-option>
                </mat-select>
              </mat-form-field>
            </div>
            <div class="two">
              <mat-form-field>
                <mat-label>区段</mat-label>
                <mat-select [(ngModel)]="segmentId" (ngModelChange)="selectSegment($event)">
                  @for (segment of segments; track segment.id) { <mat-option [value]="segment.id">{{segment.order}}. {{segment.id}} · {{segment.name}}</mat-option> }
                </mat-select>
              </mat-form-field>
              <mat-form-field>
                <mat-label>复核结论</mat-label>
                <mat-select [(ngModel)]="decision"><mat-option value="同意">同意放行</mat-option><mat-option value="有条件同意">有条件同意</mat-option><mat-option value="退回">退回</mat-option></mat-select>
              </mat-form-field>
            </div>
            <div class="version-line">提交前锁定版本：风险 v{{selectedSegment?.riskRevision}} / 会签 <b>r{{basisRevision}}</b>。若提交前已被他人推进，系统将拒绝本次后到写入。</div>
            <mat-form-field class="wide">
              <mat-label>审批条件与依据</mat-label>
              <textarea matInput rows="5" [(ngModel)]="content" placeholder="明确区段、限速、防护物资、监护窗口、应急证据和有效期"></textarea>
            </mat-form-field>
            <div class="actions">
              <button mat-flat-button color="primary" [disabled]="!content.trim() || !segmentId" (click)="submitReview()">提交意见</button>
              <button mat-stroked-button [disabled]="!segmentId" (click)="simulateConcurrent()">模拟两人几乎同时提交同一区段</button>
            </div>
          </section>
        </mat-tab>

        <mat-tab [label]="'审计时间线（' + timeline.length + '）'">
          <section class="card timeline">
            @for (event of timeline; track event.id) {
              <div>
                <i [class]="event.category"></i>
                <b>{{event.at}} · [{{event.category}}] {{event.title}}</b>
                <p><span>当时依据：</span>{{event.basis}}</p>
                <p><span>变化/失效原因：</span>{{event.reason}}</p>
                <p><span>会签/落版结果：</span>{{event.result}}</p>
                @if (event.refs.length) { <small>{{event.refs.join(' · ')}}</small> }
              </div>
            } @empty { <div class="empty">暂无审计事件。</div> }
          </section>
        </mat-tab>
      </mat-tab-group>
    </main>
  `,
  styles: [`
    h2{margin:0 0 6px}.baseline-bar{display:flex;gap:18px;align-items:center;margin-bottom:14px}.baseline-bar mat-form-field{min-width:330px}.baseline-meta{display:flex;flex-direction:column;gap:4px}.baseline-meta span{color:#667085;font-size:13px}.draft-card{display:flex;justify-content:space-between;gap:18px;align-items:center;margin-bottom:14px;border-left:4px solid #d97706}.draft-card p{margin:6px 0}.draft-card small{color:#7a8798}.draft-actions{display:flex;gap:10px;flex-wrap:wrap}.conflict-card{margin-bottom:14px;border-left:4px solid #dc2626}.conflict-card blockquote{margin:10px 0;padding:12px;border-left:3px solid #dc2626;background:#fef2f2;color:#7f1d1d}.comment-list{padding:0}.comment{padding:18px;border-bottom:1px solid #e7ebf1}.comment.invalid{background:#f8fafc;opacity:.88}.comment-head{display:flex;justify-content:space-between;gap:12px}.comment-head small{display:block;color:#7a8798;margin-top:4px}.comment p{color:#475569}.status{padding:3px 9px;border-radius:999px;font-size:12px;white-space:nowrap}.status-ok{background:#dcfce7;color:#166534}.status-wait{background:#fef3c7;color:#92400e}.status-bad,.status-expired{background:#fee2e2;color:#991b1b}.actions{display:flex;gap:10px;flex-wrap:wrap}.actions button{margin-top:6px}dl{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin:10px 0}dt{display:inline;color:#7a8798;font-size:12px;margin-right:6px}dd{display:inline;margin:0;font-size:13px}.form-card{max-width:900px}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.two mat-form-field,.wide{width:100%}.version-line{background:#eff6ff;border:1px solid #bfdbfe;padding:10px 12px;border-radius:6px;color:#1e40af;font-size:13px;margin-bottom:14px}.resign-banner{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;padding:10px 12px;border-radius:6px;margin-bottom:14px}.timeline{padding:8px 18px}.timeline>div{position:relative;padding:14px 10px 14px 28px;border-left:2px solid #cbd5e1}.timeline i{position:absolute;width:10px;height:10px;border-radius:50%;background:#2563eb;left:-6px;top:20px}.timeline i.风险{background:#dc2626}.timeline i.顺序{background:#d97706}.timeline i.替代方案{background:#7c3aed}.timeline i.基线{background:#0f172a}.timeline i.冲突{background:#dc2626}.timeline i.草案{background:#0891b2}.timeline p{color:#475569;margin:5px 0 0}.timeline p span{color:#7a8798}.timeline small{display:block;color:#7a8798;margin-top:5px}.empty{padding:28px;text-align:center;color:#7a8798}
    @media(max-width:680px){.two{grid-template-columns:1fr}.draft-card{display:block}.baseline-bar{display:block}.baseline-bar mat-form-field{width:100%;min-width:0}dl{grid-template-columns:1fr}}
  `],
})
export class ApprovalComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  routes: RoutePackage[] = []
  selectedRouteId = ''
  selectedSegmentId = ''
  segmentId = ''
  role = '安全'
  author = '当前审阅人'
  decision: ReviewDecision = '有条件同意'
  content = ''
  basisRevision = 1
  reSignOf = ''

  constructor() {
    this.state$.subscribe((state) => {
      this.routes = state.routes
      this.selectedRouteId = state.selectedRouteId
      this.selectedSegmentId = state.selectedSegmentId
      if (!this.segmentId || !this.route?.segments.some((segment) => segment.id === this.segmentId)) {
        this.segmentId = state.selectedSegmentId
      }
      this.basisRevision = this.selectedSegment?.revision ?? 1
    })
  }

  get route(): RoutePackage | undefined { return this.routes.find((route) => route.id === this.selectedRouteId) }
  get segments(): RiskSegment[] { return this.route?.segments ?? [] }
  get selectedSegment(): RiskSegment | undefined { return this.segments.find((segment) => segment.id === this.segmentId) }
  get comments(): ReviewComment[] { return this.stateValue.comments.filter((comment) => comment.routeId === this.selectedRouteId) }
  get timeline(): TimelineEvent[] { return this.stateValue.timeline.filter((event) => event.routeId === this.selectedRouteId) }
  get conflict() { return this.stateValue.conflict }
  private get stateValue(): RouteState { let state: RouteState = initialStateSnapshot; this.state$.subscribe((value) => { state = value }).unsubscribe(); return state }

  selectRoute(id: string) { this.store.dispatch(RouteActions.selectRoute({ id })); this.segmentId = this.routes.find((route) => route.id === id)?.segments[0]?.id ?? ''; this.reSignOf = '' }
  selectSegment(id: string) { this.segmentId = id; this.basisRevision = this.segments.find((segment) => segment.id === id)?.revision ?? this.basisRevision }
  submitReview() {
    if (!this.route || !this.selectedSegment || !this.content.trim()) return
    this.store.dispatch(RouteActions.submitReview({
      routeId: this.route.id,
      segmentId: this.segmentId,
      role: this.role,
      author: this.author,
      decision: this.decision,
      content: this.content.trim(),
      expectedRevision: this.basisRevision,
      reSignOf: this.reSignOf || undefined,
    }))
    if (!this.reSignOf) this.content = ''
    this.reSignOf = ''
  }
  simulateConcurrent() {
    if (!this.route || !this.selectedSegment) return
    const expected = this.basisRevision
    this.store.dispatch(RouteActions.submitReview({
      routeId: this.route.id, segmentId: this.segmentId, role: '安全', author: '韩洁', decision: '同意',
      content: '先到版本：同意按当前风险依据会签，入口核对限速与防护物资。', expectedRevision: expected,
    }))
    this.role = '应急'
    this.author = '罗晋'
    this.decision = '有条件同意'
    this.content = '后到版本：要求长隧道出口增加 20 分钟应急驻点监护，后方可放行。'
    this.store.dispatch(RouteActions.submitReview({
      routeId: this.route.id, segmentId: this.segmentId, role: this.role, author: this.author, decision: this.decision,
      content: this.content, expectedRevision: expected,
    }))
  }
  resolve(id: string, status: '已接受' | '已退回') { this.store.dispatch(RouteActions.resolveComment({ id, status })) }
  lockBaseline() { if (this.route) this.store.dispatch(RouteActions.lockBaseline({ routeId: this.route.id })) }
  applyDraft() { if (this.route?.pendingDraft) this.store.dispatch(RouteActions.applyDraft({ routeId: this.route.id, draftId: this.route.pendingDraft.id })) }
  discardDraft() { if (this.route?.pendingDraft) this.store.dispatch(RouteActions.discardDraft({ routeId: this.route.id, draftId: this.route.pendingDraft.id })) }
  dismissConflict() { this.store.dispatch(RouteActions.clearConflict()) }
  restoreConflict() {
    const conflict = this.conflict
    if (!conflict) return
    this.role = conflict.role
    this.author = conflict.author
    this.content = conflict.content
    this.segmentId = conflict.segmentId
    this.basisRevision = conflict.actualRevision
    this.store.dispatch(RouteActions.clearConflict())
  }
  resign(comment: ReviewComment) {
    this.segmentId = comment.segmentId
    this.role = comment.role
    this.author = '当前审阅人'
    this.decision = '有条件同意'
    this.content = `基于当前风险 v${this.selectedSegment?.riskRevision} 重新复核：${comment.content}`
    this.reSignOf = comment.id
    this.basisRevision = this.selectedSegment?.revision ?? comment.basisRevision + 1
  }
  statusClass(status: ReviewComment['status']) {
    if (status === '已接受') return 'status-ok'
    if (status === '待确认') return 'status-wait'
    return status === '已退回' ? 'status-bad' : 'status-expired'
  }
}

const initialStateSnapshot: RouteState = { routes: [], selectedRouteId: '', selectedSegmentId: '', comments: [], timeline: [], conflict: null, loading: false, error: '', version: 1 }
