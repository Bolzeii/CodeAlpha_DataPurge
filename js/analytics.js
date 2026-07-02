// js/analytics.js — Dashboard & Charts

export class AnalyticsDashboard {
  constructor(db) {
    this.db = db;
    this.container = null;
    this.charts = {};
  }

  init(container) {
    this.container = container;
    this._render();
  }

  _render() {
    this.container.innerHTML = `
      <div class="card-grid mb-lg">
        <div class="stat-card info">
          <div class="stat-label">Total Clean Records</div>
          <div class="stat-value" id="dash-total">0</div>
        </div>
        <div class="stat-card success">
          <div class="stat-label">Duplication Prevention Rate</div>
          <div class="stat-value" id="dash-rate">0%</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-label">Pending Review</div>
          <div class="stat-value" id="dash-pending">0</div>
        </div>
        <div class="stat-card danger">
          <div class="stat-label">Confirmed Duplicates</div>
          <div class="stat-value" id="dash-duplicates">0</div>
        </div>
      </div>

      <div class="card-grid mb-lg">
        <div class="card">
          <h3 class="card-title">Classification Breakdown</h3>
          <div class="chart-container chart-small"><canvas id="chart-classification"></canvas></div>
        </div>
        <div class="card">
          <h3 class="card-title">Algorithm Confidence Weights</h3>
          <div class="chart-container chart-small"><canvas id="chart-algorithms"></canvas></div>
        </div>
      </div>
    `;
    
    // Set default Chart.js styles for dark mode
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Inter';
    Chart.defaults.plugins.legend.labels.color = '#e2e8f0';
  }

  async update(engineResults = null) {
    const stats = await this.db.getStats();
    const duplicates = await this.db.getAllDuplicates();
    
    // Update Stat Cards
    document.getElementById('dash-total').textContent = stats.totalRecords;
    document.getElementById('dash-pending').textContent = stats.pendingDuplicates;
    document.getElementById('dash-duplicates').textContent = stats.resolvedDuplicates;
    
    const totalProcessed = stats.totalRecords + stats.totalDuplicates;
    const rate = totalProcessed > 0 ? ((stats.totalDuplicates / totalProcessed) * 100).toFixed(1) : 0;
    document.getElementById('dash-rate').textContent = `${rate}%`;

    // Chart: Classification
    const ctxClass = document.getElementById('chart-classification');
    if (ctxClass) {
      const confirmed = duplicates.filter(d => d.classification === 'duplicate').length;
      const probable = duplicates.filter(d => d.classification === 'probable').length;
      const falsePos = duplicates.filter(d => d.classification === 'false_positive').length;
      
      if (this.charts.classification) this.charts.classification.destroy();
      
      this.charts.classification = new Chart(ctxClass, {
        type: 'doughnut',
        data: {
          labels: ['Unique', 'Probable Duplicate', 'Confirmed Duplicate', 'False Positive'],
          datasets: [{
            data: [stats.totalRecords, probable, confirmed, falsePos],
            backgroundColor: ['#10b981', '#f59e0b', '#f43f5e', '#3b82f6'],
            borderWidth: 0, hoverOffset: 4
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%' }
      });
    }

    // Chart: Algorithm Radar (Mocked averages for demonstration of UI)
    const ctxRadar = document.getElementById('chart-algorithms');
    if (ctxRadar) {
      if (this.charts.radar) this.charts.radar.destroy();
      
      // Calculate real averages if engineResults exist, otherwise show baseline
      let lev = 85, jw = 78, sx = 65, ng = 72, ex = 40;
      
      if (engineResults && engineResults.length > 0) {
        // Aggregate breakdown stats
        let total = 0;
        let sums = { levenshtein: 0, jaroWinkler: 0, soundex: 0, ngram: 0, exact: 0 };
        engineResults.forEach(r => {
          if (r.breakdown) {
            Object.values(r.breakdown).forEach(f => {
              if (f.algorithms) {
                total++;
                sums.levenshtein += f.algorithms.levenshtein || 0;
                sums.jaroWinkler += f.algorithms.jaroWinkler || 0;
                sums.soundex += f.algorithms.soundex || 0;
                sums.ngram += f.algorithms.ngram || 0;
                sums.exact += f.algorithms.exact || 0;
              }
            });
          }
        });
        if (total > 0) {
          lev = (sums.levenshtein/total)*100;
          jw = (sums.jaroWinkler/total)*100;
          sx = (sums.soundex/total)*100;
          ng = (sums.ngram/total)*100;
          ex = (sums.exact/total)*100;
        }
      }

      this.charts.radar = new Chart(ctxRadar, {
        type: 'radar',
        data: {
          labels: ['Levenshtein', 'Jaro-Winkler', 'Soundex', 'N-Gram', 'Exact Match'],
          datasets: [{
            label: 'Avg Confidence Contribution',
            data: [lev, jw, sx, ng, ex],
            backgroundColor: 'rgba(124, 58, 237, 0.2)',
            borderColor: '#7c3aed',
            pointBackgroundColor: '#06b6d4',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            r: { angleLines: { color: 'rgba(255,255,255,0.1)' }, grid: { color: 'rgba(255,255,255,0.1)' }, pointLabels: { color: '#e2e8f0' }, ticks: { display: false, min: 0, max: 100 } }
          }
        }
      });
    }
  }
}
