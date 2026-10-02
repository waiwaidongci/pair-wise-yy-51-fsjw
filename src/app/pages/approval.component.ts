import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTabsModule } from '@angular/material/tabs'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import type { Countersign, DraftChange, ReviewRole, RoutePackage, TimelineEvent } from '../types'

@Component({
  selector: 'app-approval',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule],
  template: `
    <main class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">安全 · 运营 · 应急会签</p>
          <h1>区段会签、失效重算与审计基线</h1>
          <p>任一区段风险变化即重算相关旧会签：失效意见保留当时依据与失效原因，未受影响区段意见继续有效；两人同时提交同一区段时先到接纳、后到意见保留；基线锁定后修改仅生成待复核草案。</p>
        </div>
        <div class="head-actions">
          <span class="baseline-chip" [class.locked]="baselineLocked">{{ baselineLocked ? '审计基线已锁定' : '基线未锁定' }}</span>
          <button mat-flat-button color="primary" (click)="lock()" [disabled]="baselineLocked">锁定审计基线</button>
        </div>
      </div>

      @if (conflictNotice) {
        <div class="notice warn">
          <b>版本冲突 · 后到意见已保留</b>
          <span>{{ conflictNotice }}</span>
          <button mat-button (click)="clearNotice()">知道了</button>
        </div>
      }
      @if (baselineLocked) {
        <div class="notice lock">
          <b>审计基线已锁定</b>
          <span>锁定后区段风险、路径顺序与替代方案修改不再改动正式记录，仅生成待复核草案，在「待复核草案」页签批准或驳回。</span>
        </div>
      }

      <mat-tab-group>
        <mat-tab>
          <ng-template mat-tab-label>会签意见 <span class="tab-badge">{{ countersigns.length }}</span></ng-template>
          @for (cs of countersigns; track cs.id) {
            <div class="cs-card" [class.invalid]="cs.status === '已失效'" [class.draft]="cs.status === '待复核草案'">
              <div class="cs-head">
                <div>
                  <b>{{ cs.role }} · {{ cs.author }}</b>
                  <small>{{ cs.segmentId }} · {{ cs.segmentName }} · {{ cs.id }} · {{ cs.createdAt }}</small>
                </div>
                <span class="status-chip" [class]="chipClass(cs.status)">{{ cs.status }}</span>
              </div>
              <p class="cs-content">{{ cs.content }}</p>
              <div class="cs-meta">
                <div class="meta-row"><i class="dot basis"></i><span><b>当时依据</b>{{ cs.basis }}</span></div>
                @if (cs.invalidationReason) {
                  <div class="meta-row"><i class="dot invalid"></i><span><b>失效原因</b>{{ cs.invalidationReason }}</span></div>
                }
                @if (cs.draftReason) {
                  <div class="meta-row"><i class="dot draft"></i><span><b>意见保留</b>{{ cs.draftReason }}</span></div>
                }
                @if (cs.supersededBy) {
                  <div class="meta-row"><i class="dot resign"></i><span><b>重新会签结果</b>已由新意见 {{ cs.supersededBy }} 重新会签闭环，原依据与失效原因留存可查。</span></div>
                }
                @if (cs.supersedes) {
                  <div class="meta-row"><i class="dot resign"></i><span><b>重新会签结果</b>本意见取代失效意见 {{ cs.supersedes }}，会签依据已按最新风险快照更新。</span></div>
                }
              </div>
              @if (cs.status === '已失效') {
                @if (resigningId === cs.id) {
                  <div class="resign-box">
                    <mat-form-field class="wide"><mat-label>重新会签意见与管控条件</mat-label><textarea matInput rows="3" [(ngModel)]="resignContent" placeholder="按最新风险等级明确管控条件、时限与验收证据"></textarea></mat-form-field>
                    <div class="actions">
                      <button mat-stroked-button (click)="resigningId = ''; resignContent = ''">取消</button>
                      <button mat-flat-button color="primary" [disabled]="!resignContent.trim()" (click)="confirmResign(cs)">完成重新会签</button>
                    </div>
                  </div>
                } @else {
                  <div class="actions"><button mat-flat-button color="primary" (click)="startResign(cs)">重新会签</button></div>
                }
              }
            </div>
          } @empty {
            <p class="empty">暂无会签意见</p>
          }
        </mat-tab>

        <mat-tab label="发表会签意见">
          <section class="card form-card">
            <div class="two">
              <mat-form-field>
                <mat-label>运输单</mat-label>
                <mat-select [(ngModel)]="formRouteId" (ngModelChange)="onRouteChange()">
                  @for (route of routes; track route.id) { <mat-option [value]="route.id">{{ route.id }} · {{ route.trainCode }}</mat-option> }
                </mat-select>
              </mat-form-field>
              <mat-form-field>
                <mat-label>区段</mat-label>
                <mat-select [(ngModel)]="formSegmentId">
                  @for (segment of formSegments; track segment.id) {
                    <mat-option [value]="segment.id">{{ segment.id }} · {{ segment.name }}（v{{ segment.version }}）</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
            <div class="two">
              <mat-form-field>
                <mat-label>专业角色</mat-label>
                <mat-select [(ngModel)]="role">
                  <mat-option value="安全">安全</mat-option>
                  <mat-option value="运营">运营</mat-option>
                  <mat-option value="应急">应急</mat-option>
                </mat-select>
              </mat-form-field>
              <div class="version-hint">
                <small>乐观锁依据</small>
                <b>区段版本 v{{ formSegment?.version }}</b>
                <small>提交时携带版本：先到接纳并升级版本，后到见版本变化、意见保留为草案</small>
              </div>
            </div>
            <mat-form-field class="wide">
              <mat-label>会签意见与依据</mat-label>
              <textarea matInput rows="5" [(ngModel)]="content" placeholder="明确区段风险、管控条件、时限与验收证据"></textarea>
            </mat-form-field>
            <div class="actions">
              <button mat-flat-button color="primary" [disabled]="!content.trim()" (click)="submit()">提交会签意见</button>
              <button mat-stroked-button (click)="simulate()">模拟两人同时提交同一区段</button>
            </div>
            @if (baselineLocked) {
              <p class="lock-hint">基线已锁定：提交仅生成待复核草案，不覆盖正式会签记录。</p>
            }
          </section>
        </mat-tab>

        <mat-tab>
          <ng-template mat-tab-label>待复核草案 <span class="tab-badge">{{ pendingDrafts.length }}</span></ng-template>
          @for (draft of pendingDrafts; track draft.id) {
            <div class="card draft-card">
              <div class="cs-head">
                <div>
                  <b>{{ draft.description }}</b>
                  <small>{{ draft.id }} · {{ draft.kind }} · {{ draft.createdAt }} · {{ draft.author }}</small>
                </div>
                <span class="status-chip draft">待复核</span>
              </div>
              <p class="draft-reason">{{ draft.reason }}</p>
              <div class="actions">
                <button mat-stroked-button color="warn" (click)="reject(draft.id)">驳回</button>
                <button mat-flat-button color="primary" (click)="approve(draft.id)">批准并应用</button>
              </div>
            </div>
          } @empty {
            <p class="empty">暂无待复核草案</p>
          }
        </mat-tab>

        <mat-tab label="审计时间线">
          <section class="card timeline">
            @for (event of timeline; track event.id) {
              <div class="tl-item">
                <i class="tl-dot" [class]="dotClass(event.kind)"></i>
                <div class="tl-body">
                  <div class="tl-head">
                    <span class="kind-chip" [class]="dotClass(event.kind)">{{ event.kind }}</span>
                    <b>{{ event.title }}</b>
                    <span class="tl-time">{{ event.time }}</span>
                  </div>
                  <p>{{ event.detail }}</p>
                </div>
              </div>
            }
          </section>
        </mat-tab>
      </mat-tab-group>
    </main>
  `,
  styles: [`
    .page-head { align-items: flex-start; }
    .head-actions { display: flex; align-items: center; gap: 12px; }
    .baseline-chip { padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; background: #eef2f6; color: #475569; border: 1px solid #d5dde7; }
    .baseline-chip.locked { background: #f3e8ff; color: #7e22ce; border-color: #d8b4fe; }
    .notice { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 8px; margin-bottom: 14px; font-size: 13px; }
    .notice b { white-space: nowrap; }
    .notice span { color: #475569; }
    .notice button { margin-left: auto; }
    .notice.warn { background: #fffbeb; border: 1px solid #fde68a; }
    .notice.warn b { color: #b45309; }
    .notice.lock { background: #f5f3ff; border: 1px solid #ddd6fe; }
    .notice.lock b { color: #7e22ce; }
    .tab-badge { display: inline-block; min-width: 20px; padding: 0 6px; margin-left: 6px; border-radius: 999px; background: #2563eb; color: #fff; font-size: 11px; line-height: 18px; text-align: center; }
    .cs-card { border: 1px solid #e1e7ef; border-left: 4px solid #2563eb; border-radius: 8px; padding: 16px 18px; margin: 12px 0; background: #fff; }
    .cs-card.invalid { border-left-color: #dc2626; background: #fefcfc; }
    .cs-card.draft { border-left-color: #d97706; background: #fffdf7; }
    .cs-head { display: flex; justify-content: space-between; gap: 12px; }
    .cs-head small { display: block; color: #7a8798; margin-top: 4px; }
    .cs-content { color: #334155; margin: 10px 0; }
    .status-chip { padding: 3px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .status-chip.valid { background: #dcfce7; color: #15803d; }
    .status-chip.invalid { background: #fee2e2; color: #dc2626; }
    .status-chip.draft { background: #fef3c7; color: #b45309; }
    .cs-meta { display: grid; gap: 6px; margin: 10px 0; }
    .meta-row { display: flex; gap: 8px; font-size: 12.5px; color: #475569; line-height: 1.6; }
    .meta-row b { color: #182230; margin-right: 6px; white-space: nowrap; }
    .dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 7px; flex: none; }
    .dot.basis { background: #2563eb; }
    .dot.invalid { background: #dc2626; }
    .dot.draft { background: #d97706; }
    .dot.resign { background: #15803d; }
    .actions { display: flex; gap: 10px; margin-top: 8px; }
    .resign-box { margin-top: 10px; padding: 12px; border: 1px dashed #cbd5e1; border-radius: 8px; background: #f8fafc; }
    .form-card { max-width: 820px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .wide { width: 100%; }
    .version-hint { display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 0 4px; }
    .version-hint small { color: #7a8798; font-size: 11px; }
    .version-hint b { color: #2563eb; font-size: 15px; }
    .lock-hint { margin: 10px 0 0; color: #7e22ce; font-size: 12.5px; }
    .draft-card { border-left: 4px solid #d97706; }
    .draft-reason { color: #475569; font-size: 13px; }
    .empty { color: #94a3b8; padding: 24px; text-align: center; }
    .timeline { padding: 8px 18px; }
    .tl-item { display: flex; gap: 12px; padding: 14px 0; border-bottom: 1px solid #edf0f5; }
    .tl-item:last-child { border-bottom: none; }
    .tl-dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 6px; flex: none; background: #94a3b8; }
    .tl-dot.basis { background: #2563eb; }
    .tl-dot.invalid { background: #dc2626; }
    .tl-dot.resign { background: #15803d; }
    .tl-dot.lock { background: #9333ea; }
    .tl-dot.draft { background: #d97706; }
    .tl-dot.conflict { background: #ea580c; }
    .tl-dot.path { background: #0891b2; }
    .tl-dot.approve { background: #15803d; }
    .tl-dot.reject { background: #64748b; }
    .tl-body { flex: 1; }
    .tl-head { display: flex; align-items: center; gap: 10px; }
    .tl-head b { font-size: 14px; }
    .tl-time { margin-left: auto; color: #94a3b8; font-size: 12px; white-space: nowrap; }
    .kind-chip { padding: 2px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #fff; background: #64748b; white-space: nowrap; }
    .kind-chip.basis { background: #2563eb; }
    .kind-chip.invalid { background: #dc2626; }
    .kind-chip.resign { background: #15803d; }
    .kind-chip.lock { background: #9333ea; }
    .kind-chip.draft { background: #d97706; }
    .kind-chip.conflict { background: #ea580c; }
    .kind-chip.path { background: #0891b2; }
    .kind-chip.approve { background: #15803d; }
    .kind-chip.reject { background: #64748b; }
    .tl-body p { margin: 5px 0 0; color: #667085; font-size: 12.5px; line-height: 1.6; }
    @media (max-width: 620px) {
      .two { grid-template-columns: 1fr; }
      .head-actions { width: 100%; }
    }
  `],
})
export class ApprovalComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')

  routes: RoutePackage[] = []
  countersigns: Countersign[] = []
  timeline: TimelineEvent[] = []
  drafts: DraftChange[] = []
  baselineLocked = false
  conflictNotice = ''

  formRouteId = ''
  formSegmentId = ''
  role: ReviewRole = '安全'
  content = ''
  resigningId = ''
  resignContent = ''

  constructor() {
    this.state$.subscribe((state) => {
      this.routes = state.routes
      this.countersigns = state.countersigns
      this.timeline = state.timeline
      this.drafts = state.drafts
      this.baselineLocked = state.baselineLocked
      this.conflictNotice = state.conflictNotice
      if (!this.formRouteId && state.routes.length) {
        this.formRouteId = state.selectedRouteId || state.routes[0].id
        this.formSegmentId = state.selectedSegmentId || this.formSegments[0]?.id || ''
      }
    })
  }

  get formSegments() {
    return this.routes.find((route) => route.id === this.formRouteId)?.segments ?? []
  }

  get formSegment() {
    return this.formSegments.find((segment) => segment.id === this.formSegmentId)
  }

  get pendingDrafts() {
    return this.drafts.filter((draft) => draft.status === '待复核')
  }

  onRouteChange() {
    this.formSegmentId = this.formSegments[0]?.id ?? ''
  }

  chipClass(status: Countersign['status'] | string) {
    return { 有效: 'valid', 已失效: 'invalid', 待复核草案: 'draft' }[status] ?? 'valid'
  }

  dotClass(kind: TimelineEvent['kind'] | string) {
    return {
      会签依据: 'basis',
      失效原因: 'invalid',
      重新会签结果: 'resign',
      基线锁定: 'lock',
      草案生成: 'draft',
      版本冲突: 'conflict',
      路径变更: 'path',
      草案批准: 'approve',
      草案驳回: 'reject',
    }[kind] ?? 'basis'
  }

  submit() {
    const segment = this.formSegment
    if (!segment) return
    this.store.dispatch(RouteActions.submitCountersign({
      routeId: this.formRouteId,
      segmentId: segment.id,
      role: this.role,
      author: '当前审阅人',
      content: this.content.trim(),
      expectedVersion: segment.version,
    }))
    this.content = ''
  }

  simulate() {
    this.store.dispatch(RouteActions.simulateConcurrentSubmit({ segmentId: this.formSegmentId || undefined }))
  }

  startResign(cs: Countersign) {
    this.resigningId = cs.id
    this.resignContent = ''
  }

  confirmResign(cs: Countersign) {
    this.store.dispatch(RouteActions.resignCountersign({
      countersignId: cs.id,
      content: this.resignContent.trim(),
      author: '当前审阅人',
    }))
    this.resigningId = ''
    this.resignContent = ''
  }

  approve(id: string) {
    this.store.dispatch(RouteActions.approveDraft({ id }))
  }

  reject(id: string) {
    this.store.dispatch(RouteActions.rejectDraft({ id }))
  }

  lock() {
    this.store.dispatch(RouteActions.lockBaseline())
  }

  clearNotice() {
    this.store.dispatch(RouteActions.clearConflictNotice())
  }
}
