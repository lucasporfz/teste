function renderValidatorHistogram(data, simHitsHist) {
  const hits = data.hitsPerTurn || [];
  if (hits.length === 0) return;

  // Histograma do log real
  const counts = {};
  let maxHit = 0;
  for (const h of hits) {
    counts[h] = (counts[h] || 0) + 1;
    if (h > maxHit) maxHit = h;
  }
  const realTotal = hits.length;

  // Histograma simulado (opcional)
  let maxSimHit = 0;
  let simTotal = 0;
  if (simHitsHist) {
    for (const k in simHitsHist) {
      const v = +k;
      if (v > maxSimHit) maxSimHit = v;
      simTotal += simHitsHist[k];
    }
  }

  // Eixo X: 0 até max(real, sim) + 1
  const xMax = Math.max(maxHit, maxSimHit) + 1;
  const labels = [];
  const dataArr = [];    // real — % dos turnos
  const simDataArr = []; // sim  — % dos turnos
  for (let i = 0; i <= xMax; i++) {
    labels.push(i);
    dataArr.push(realTotal > 0 ? +((counts[i] || 0) / realTotal * 100).toFixed(2) : 0);
    simDataArr.push(simTotal > 0 && simHitsHist ? +((simHitsHist[i] || 0) / simTotal * 100).toFixed(2) : 0);
  }

  const hasSim = simHitsHist && simTotal > 0;

  // Plugin: 2 linhas verticais (saída/box)
  const verticalLinesPlugin = {
    id: 'verticalLines',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      const drawLine = (value, color, label) => {
        const xPx = xScale.getPixelForValue(value);
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.moveTo(xPx, yScale.top);
        ctx.lineTo(xPx, yScale.bottom);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = '500 11px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label + ' = ' + value, xPx, yScale.top - 4);
        ctx.restore();
      };
      drawLine(data.exitP5, '#EF4444', t('val_histogram_exit'));
      drawLine(data.boxSizeP95, '#10B981', t('val_histogram_box'));
      if (data.boxSizeStrictP90 && data.boxSizeStrictP90 !== data.boxSizeP95) {
        drawLine(data.boxSizeStrictP90, 'rgba(16,185,129,0.45)', t('val_card_strict_p90'));
      }
    }
  };

  const datasets = [
    {
      type: 'bar',
      label: t('val_histogram_label'),
      data: dataArr,
      backgroundColor: 'rgba(59, 130, 246, 0.5)',
      borderColor: '#3B82F6',
      borderWidth: 1,
      borderRadius: 2,
      order: 2
    }
  ];
  if (hasSim) {
    datasets.push({
      type: 'line',
      label: t('val_histogram_label_sim'),
      data: simDataArr,
      borderColor: '#00C49A',
      backgroundColor: 'rgba(0, 196, 154, 0.08)',
      borderWidth: 2,
      pointRadius: 2.5,
      pointBackgroundColor: '#00C49A',
      fill: true,
      tension: 0.35,
      order: 1
    });
  }

  if (valHistogramChart) valHistogramChart.destroy();
  valHistogramChart = new Chart($('valHistogram'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: hasSim ? 20 : 18 } },
      plugins: {
        legend: {
          display: hasSim,
          labels: { color: '#8BA4C2', font: { size: 11 }, boxWidth: 12, padding: 12 }
        },
        tooltip: {
          callbacks: {
            title: items => items[0].label + ' ' + t('val_histogram_x').split('(')[0].trim(),
            label: ctx => ' ' + ctx.parsed.y.toFixed(1) + '% — ' + ctx.dataset.label
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(139,164,194,0.1)' },
          ticks: { color: '#8BA4C2', font: { size: 11 } },
          title: { display: true, text: t('val_histogram_x'), color: '#8BA4C2', font: { size: 11 } }
        },
        y: {
          grid: { color: 'rgba(139,164,194,0.1)' },
          ticks: { color: '#8BA4C2', font: { size: 11 }, callback: v => v + '%' },
          beginAtZero: true,
          title: { display: true, text: t('val_histogram_y'), color: '#8BA4C2', font: { size: 11 } }
        }
      }
    },
    plugins: [verticalLinesPlugin]
  });
  renderValidatorRpComponentHistograms(data, simHitsHist && simHitsHist.components ? simHitsHist.components : null);
}

function histogramFromArray(values) {
  const hist = {};
  for (const v of values || []) {
    const key = Math.max(0, Math.round(v || 0));
    hist[key] = (hist[key] || 0) + 1;
  }
  return hist;
}

function histTotal(hist) {
  let total = 0;
  for (const k in (hist || {})) total += hist[k] || 0;
  return total;
}

function renderSmallComponentHistogram(canvasId, assignChart, realValues, simHist, title, note) {
  const canvas = $(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  const realHist = histogramFromArray(realValues || []);
  const realTotal = histTotal(realHist);
  const simTotal = histTotal(simHist);
  let maxHit = 0;
  for (const k in realHist) maxHit = Math.max(maxHit, +k);
  for (const k in (simHist || {})) maxHit = Math.max(maxHit, +k);
  const labels = [];
  const realData = [];
  const simData = [];
  for (let i = 0; i <= Math.max(1, maxHit + 1); i++) {
    labels.push(i);
    realData.push(realTotal ? +((realHist[i] || 0) / realTotal * 100).toFixed(2) : 0);
    simData.push(simTotal ? +((simHist[i] || 0) / simTotal * 100).toFixed(2) : 0);
  }
  const datasets = [
    {
      type: 'bar',
      label: t('val_rp_component_real'),
      data: realData,
      backgroundColor: 'rgba(59, 130, 246, 0.48)',
      borderColor: '#3B82F6',
      borderWidth: 1,
      order: 2
    }
  ];
  if (simTotal > 0) {
    datasets.push({
      type: 'line',
      label: t('val_rp_component_sim'),
      data: simData,
      borderColor: '#00C49A',
      backgroundColor: 'rgba(0,196,154,.08)',
      borderWidth: 2,
      pointRadius: 2,
      tension: 0.3,
      fill: true,
      order: 1
    });
  }
  assignChart(new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: simTotal > 0, labels: { color: '#8BA4C2', font: { size: 10 }, boxWidth: 10 } },
        title: { display: true, text: title + ' · n=' + realTotal + (note ? ' · ' + note : ''), color: '#DDE6F3', font: { size: 12, weight: '500' } },
        tooltip: { callbacks: { label: ctx => ' ' + ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(1) + '%' } }
      },
      scales: {
        x: { grid: { color: 'rgba(139,164,194,0.1)' }, ticks: { color: '#8BA4C2', font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: 'rgba(139,164,194,0.1)' }, ticks: { color: '#8BA4C2', font: { size: 10 }, callback: v => v + '%' } }
      }
    }
  }));
}

function renderValidatorRpComponentDebug(data) {
  const el = $('valRpComponentDebug');
  if (!el) return;
  const examples = data && data.rpComponentDebugExamples || [];
  if (!examples.length) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const reasonLabel = reason => reason === 'cast'
    ? t('val_rp_debug_reason_cast')
    : reason === 'explode'
    ? t('val_rp_debug_reason_explode')
    : t('val_rp_debug_reason_order');
  const originalDisplay = line => {
    const element = line.correctedComponent === 'rune'
      ? (line.runeElement || line.inferredElement || '—')
      : (line.inferredElement || '—');
    const key = element && element !== '—' ? element + 'Original' : '';
    const value = key && Number.isFinite(line[key])
      ? line[key]
      : Number.isFinite(line.secondOriginal)
      ? line.secondOriginal
      : Number.isFinite(line.holyOriginal)
      ? line.holyOriginal
      : null;
    return { element, value };
  };
  const rows = examples.map(ex => {
    const lines = (ex.lines || []).map(line => {
      const original = originalDisplay(line);
      return '<div style="display:grid;grid-template-columns:90px 70px 1fr 70px 120px 90px 140px;gap:8px;padding:2px 0;border-top:1px solid rgba(139,164,194,.10)">' +
        '<span>' + (line.beforeComponent || line.component) + '→' + (line.correctedComponent || line.component) + '</span>' +
        '<span>' + line.type + '</span>' +
        '<span>' + (line.mob || 'mob') + '</span>' +
        '<span>' + Math.round(line.dmg || 0) + '</span>' +
        '<span>' + original.element + ' ' + (Number.isFinite(original.value) ? Math.round(original.value) : '—') + '</span>' +
        '<span>' + reasonLabel(line.reason) + '</span>' +
        '<span>' + (line.correctionReason || 'count') + '</span>' +
      '</div>';
    }).join('');
    return '<div style="margin-top:8px">' +
      '<strong>' + t('val_rp_debug_turn') + ' ' + ex.turn + '</strong>' +
      ' · ' + ex.mark + ' · raw=' + ex.rawAttackHits +
      ' · arrow=' + Math.round((ex.components && ex.components.arrow) || 0) +
      ' spell=' + Math.round((ex.components && ex.components.spell) || 0) +
      ' grenade=' + Math.round((ex.components && ex.components.grenade) || 0) +
      '<div style="margin-top:5px;font-family:Menlo,Consolas,monospace;font-size:11px;color:var(--text-muted)">' + lines + '</div>' +
    '</div>';
  }).join('');
  el.style.display = 'block';
  el.innerHTML = '<strong>' + t('val_rp_debug_title') + '</strong><br>' +
    '<span style="color:var(--text-muted)">' + t('val_rp_debug_desc') + '</span>' + rows;
}

function renderValidatorRpComponentHistograms(data, simComponentHists) {
  const section = $('valRpComponentSection');
  const destroy = chart => { try { if (chart && typeof chart.destroy === 'function') chart.destroy(); } catch (err) {} };
  destroy(valRpArrowHistogramChart);
  destroy(valRpSpellHistogramChart);
  destroy(valRpRuneHistogramChart);
  destroy(valRpGrenadeHistogramChart);
  valRpArrowHistogramChart = null;
  valRpSpellHistogramChart = null;
  valRpRuneHistogramChart = null;
  valRpGrenadeHistogramChart = null;
  if (!section || !data || !data.isPaladin || !data.rpComponentSeries) {
    if (section) section.style.display = 'none';
    const dbg = $('valRpComponentDebug');
    if (dbg) dbg.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  const real = data.rpComponentSeries;
  const sim = simComponentHists || {};
  const grenadeN = (real.grenadeHitsPerShot || []).length;
  const grenadeNote = grenadeN <= 8
    ? t('val_rp_component_small_n')
    : (grenadeN ? t('val_rp_component_samples') : t('val_rp_component_no_grenade'));
  renderSmallComponentHistogram('valRpArrowHistogram', chart => { valRpArrowHistogramChart = chart; }, real.arrowHitsPerTurn, sim.arrow, t('val_rp_component_arrow'));
  renderSmallComponentHistogram('valRpSpellHistogram', chart => { valRpSpellHistogramChart = chart; }, real.spellHitsPerTurn, sim.spell, t('val_rp_component_spell'));
  renderSmallComponentHistogram('valRpRuneHistogram', chart => { valRpRuneHistogramChart = chart; }, real.runeHitsPerTurn, sim.rune, t('val_rp_component_rune'));
  renderSmallComponentHistogram('valRpGrenadeHistogram', chart => { valRpGrenadeHistogramChart = chart; }, real.grenadeHitsPerShot, sim.grenade, t('val_rp_component_grenade'), grenadeNote);
  renderValidatorRpComponentDebug(data);
}

function histogramDistance(realHits, simHitsHist) {
  if (!realHits || realHits.length === 0 || !simHitsHist) return Infinity;
  const realCounts = {};
  let maxHit = 0;
  for (const h of realHits) {
    realCounts[h] = (realCounts[h] || 0) + 1;
    if (h > maxHit) maxHit = h;
  }
  let simTotal = 0;
  for (const k in simHitsHist) {
    const v = +k;
    if (v > maxHit) maxHit = v;
    simTotal += simHitsHist[k];
  }
  if (simTotal <= 0) return Infinity;
  let dist = 0;
  for (let i = 0; i <= maxHit; i++) {
    const realPct = (realCounts[i] || 0) / realHits.length * 100;
    const simPct = (simHitsHist[i] || 0) / simTotal * 100;
    dist += Math.abs(realPct - simPct);
  }
  return dist;
}
