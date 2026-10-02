import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatSelectModule } from '@angular/material/select'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatChipsModule } from '@angular/material/chips'
import { MatDividerModule } from '@angular/material/divider'
import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl'
import { length, lineString } from '@turf/turf'
import type { RiskLevel, RiskSegment, RoutePackage } from '../types'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'

@Component({
  selector: 'app-risk-map',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatSelectModule, MatFormFieldModule, MatCheckboxModule, MatChipsModule, MatDividerModule],
  template: `
    <main class="page">
      <div class="page-head">
        <div><p class="eyebrow">地理风险叠加</p><h1>区段风险、路径顺序与替代方案复核</h1><p>直接改动会按区段失效旧会签；锁定基线后的改动只形成待复核草案。</p></div>
        <button mat-stroked-button (click)="fitRoute()">定位整条路径</button>
      </div>
      <div class="toolbar">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>运输单 / 候选方案</mat-label>
          <mat-select [(ngModel)]="selectedRouteId" (ngModelChange)="selectRoute($event)">
            @for (route of routes; track route.id) { <mat-option [value]="route.id">{{route.id}} · {{route.trainCode}}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-checkbox [(ngModel)]="layers.tunnel" (change)="refreshLayers()">隧道</mat-checkbox>
        <mat-checkbox [(ngModel)]="layers.bridge" (change)="refreshLayers()">桥梁</mat-checkbox>
        <mat-checkbox [(ngModel)]="layers.water" (change)="refreshLayers()">水源地</mat-checkbox>
        <mat-checkbox [(ngModel)]="layers.population" (change)="refreshLayers()">人口密集区</mat-checkbox>
      </div>

      @if (selectedRoute; as currentRoute) {
        @if (currentRoute.locked) {
          <section class="card lock-banner">
            <b>审计基线 r{{currentRoute.baselineRevision}} 已锁定</b>
            <span>{{currentRoute.lockedAt}} 锁定 · 下方修改不会覆盖原依据，只写入待复核草案。</span>
          </section>
        }
      @if (selectedRoute.pendingDraft; as draft) {
        <section class="card draft-banner">
          <b>待复核草案 {{draft.id}}</b>
          <span>{{draft.summary}} · {{draft.detail}}</span>
        </section>
      }
      }

      <div class="grid-2">
        <div #mapEl class="map"></div>
        <aside class="card">
          <div class="panel-head">
            <div><h2>区段风险清单</h2><p>顺序即运输路径；意见锚定风险 v 与会签 r</p></div>
            <strong [class.risk-high]="selectedRoute !== undefined && selectedRoute.score >= 70">总风险 {{selectedRoute?.score}}</strong>
          </div>
          @for (segment of sortedSegments; track segment.id) {
            <button class="segment" [class.active]="segment.id === selectedSegmentId" (click)="selectSegment(segment)">
              <span class="segment-main">
                <b>{{segment.order}}. {{segment.name}}</b>
                <small>{{segment.from}} → {{segment.to}} · {{segment.km}} km · {{segment.speed}}</small>
                <em>{{segment.risks.join(' / ')}}</em>
                <small class="versions">风险 v{{segment.riskRevision}} / 会签 r{{segment.revision}} · {{segment.status}}</small>
              </span>
              <span class="segment-side">
                <strong [class.risk-high]="segment.level==='高'" [class.risk-mid]="segment.level==='中'" [class.risk-low]="segment.level==='低'">{{segment.level}}</strong>
                <span class="mini-actions" (click)="$event.stopPropagation()">
                  <button mat-stroked-button [disabled]="segment.order === 1" (click)="reorder(segment,-1)">↑</button>
                  <button mat-stroked-button [disabled]="segment.order === sortedSegments.length" (click)="reorder(segment,1)">↓</button>
                </span>
              </span>
            </button>
          }
          <mat-divider />
          <h3>选中区段复核</h3>
          @if (selectedSegment) {
            <div class="edit-panel">
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>风险等级</mat-label>
                <mat-select [ngModel]="selectedSegment.level" (ngModelChange)="changeRisk($event)">
                  <mat-option value="高">高</mat-option><mat-option value="中">中</mat-option><mat-option value="低">低</mat-option>
                </mat-select>
              </mat-form-field>
              <p>当前依据：风险 v{{selectedSegment.riskRevision}} / 会签 r{{selectedSegment.revision}}。变更将只失效该区段，不影响其他区段。</p>
            </div>
          }
          <h3>路径测算</h3><p>实测里程：{{routeLength}} km</p><p>预计运行：{{estimatedTime}}</p><p>限制区段：{{restrictedCount}} 处</p>
          <button mat-flat-button color="primary" style="width:100%" (click)="requireAlternative()">要求补充绕行/替代方案</button>
        </aside>
      </div>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 10px}.panel-head{display:flex;justify-content:space-between;gap:10px}.segment{width:100%;display:flex;justify-content:space-between;text-align:left;gap:10px;padding:13px;margin:6px 0;border:1px solid #e1e7ef;background:#fff;border-radius:6px;color:inherit;cursor:pointer}.segment.active{border-color:#2563eb;background:#f5f8ff}.segment-main{flex:1}.segment-side{display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end}.segment b,.segment small,.segment em{display:block}.segment small{color:#7a8798;margin:4px 0}.segment em{font-size:12px;color:#475569;font-style:normal}.versions{font-variant-numeric:tabular-nums}.mini-actions{display:flex;gap:4px}.mini-actions button{min-width:32px;padding:0 8px}.lock-banner{margin-bottom:12px;border-left:4px solid #0f172a;display:flex;gap:10px;flex-wrap:wrap}.draft-banner{margin-bottom:12px;border-left:4px solid #0891b2;display:flex;gap:10px;flex-wrap:wrap}.edit-panel mat-form-field{width:150px}.edit-panel p{font-size:12px;margin:-2px 0 10px}
  `],
})
export class RiskMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapEl') mapEl!: ElementRef<HTMLDivElement>
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  private map?: MapLibreMap
  routes: RoutePackage[] = []
  selectedRouteId = ''
  selectedSegmentId = ''
  layers = { tunnel: true, bridge: true, water: true, population: true }

  constructor() { this.state$.subscribe((state) => { this.routes = state.routes; this.selectedRouteId = state.selectedRouteId; this.selectedSegmentId = state.selectedSegmentId; if (this.map) this.drawRoute() }) }

  get selectedRoute(): RoutePackage | undefined { let route: RoutePackage | undefined; this.state$.subscribe((state) => { route = state.routes.find((item: RoutePackage) => item.id === state.selectedRouteId) }).unsubscribe(); return route }
  get sortedSegments(): RiskSegment[] { return [...(this.selectedRoute?.segments ?? [])].sort((a, b) => a.order - b.order) }
  get selectedSegment(): RiskSegment | undefined { return this.selectedRoute?.segments.find((segment) => segment.id === this.selectedSegmentId) }
  get routeLength() { return this.selectedRoute ? length(lineString(this.sortedSegments.flatMap((segment) => segment.coordinates)), { units: 'kilometers' }).toFixed(1) : '0.0' }
  get estimatedTime() { return `${Math.round(Number(this.routeLength) / 55 * 60 + this.restrictedCount * 8)} 分钟` }
  get restrictedCount() { return this.selectedRoute?.segments.filter((segment) => segment.status === '需绕行').length ?? 0 }

  ngAfterViewInit() {
    this.map = new maplibregl.Map({
      container: this.mapEl.nativeElement,
      style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] },
      center: [112.2, 34.5], zoom: 5,
    })
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right')
    this.map.on('load', () => { this.addRiskLayers(); this.drawRoute() })
  }
  ngOnDestroy() { this.map?.remove() }
  selectRoute(id: string) { this.store.dispatch(RouteActions.selectRoute({ id })) }
  selectSegment(segment: RiskSegment) { this.store.dispatch(RouteActions.selectSegment({ id: segment.id })); this.map?.flyTo({ center: segment.coordinates[0], zoom: 8 }) }
  changeRisk(level: RiskLevel) {
    if (!this.selectedRoute || !this.selectedSegment || this.selectedSegment.level === level) return
    const reason = prompt(`请填写 ${this.selectedSegment.name} 风险等级调整为「${level}」的复核依据：`, '复核人员更新区段气象、地形或应急救援条件。') ?? undefined
    this.store.dispatch(RouteActions.changeSegmentRisk({ routeId: this.selectedRoute.id, segmentId: this.selectedSegment.id, level, reason: reason || '复核人员更新区段风险依据。' }))
  }
  reorder(segment: RiskSegment, direction: -1 | 1) {
    if (!this.selectedRoute) return
    const reason = prompt(`请填写 ${segment.name} 路径顺序调整依据：`, '按实际运行径路、接发车进路和避让窗口修正顺序。') ?? undefined
    this.store.dispatch(RouteActions.reorderSegments({ routeId: this.selectedRoute.id, segmentId: segment.id, direction, reason: reason || '按实际运行径路修正顺序。' }))
  }
  requireAlternative() { if (this.selectedRoute) this.store.dispatch(RouteActions.createAlternative({ routeId: this.selectedRoute.id })) }
  fitRoute() { if (!this.map || !this.selectedRoute) return; const bounds = new LngLatBounds(); this.sortedSegments.flatMap((segment) => segment.coordinates).forEach((point) => bounds.extend(point)); this.map.fitBounds(bounds, { padding: 50 }) }
  refreshLayers() { for (const [id, visible] of Object.entries(this.layers)) { if (this.map?.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none') } }
  private addRiskLayers() {
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [
      { type: 'Feature', properties: { kind: 'tunnel' }, geometry: { type: 'Point', coordinates: [114.3, 35.2] } },
      { type: 'Feature', properties: { kind: 'bridge' }, geometry: { type: 'Point', coordinates: [116.1, 34.2] } },
      { type: 'Feature', properties: { kind: 'water' }, geometry: { type: 'Point', coordinates: [110.4, 34.8] } },
      { type: 'Feature', properties: { kind: 'population' }, geometry: { type: 'Point', coordinates: [118.0, 35.8] } },
    ]
    const colors: Record<string, string> = { tunnel: '#4f46e5', bridge: '#d97706', water: '#0891b2', population: '#dc2626' }
    Object.entries(colors).forEach(([kind, color]) => {
      this.map?.addSource(kind, { type: 'geojson', data: { type: 'FeatureCollection', features: features.filter((feature) => feature.properties?.['kind'] === kind) } })
      this.map?.addLayer({ id: kind, type: 'circle', source: kind, paint: { 'circle-radius': 10, 'circle-color': color, 'circle-opacity': .75, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
    })
  }
  private drawRoute() {
    if (!this.map?.isStyleLoaded() || !this.selectedRoute) return
    if (this.map.getLayer('route-line')) { this.map.removeLayer('route-line'); this.map.removeSource('route') }
    this.map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: this.sortedSegments.map((segment) => segment.coordinates) } } })
    this.map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#2563eb', 'line-width': 4, 'line-opacity': .9 } })
  }
}
