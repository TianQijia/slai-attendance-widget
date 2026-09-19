// Fictional records with the portal's Layui markup. No school data or sessions.
const fixtureDay = "2030-04-08";
const rows = [
  ["闸机-东", "出门", "11:00:00"],
  ["闸机-东", "进门", "10:00:00"],
  ["闸机-东", "出门", "09:00:00"],
  ...Array.from({ length: 17 }, (_, i) => ["宿舍_道闸", "出门", `08:${59 - i}:00`]),
  ["闸机-东", "进门", "08:00:00"],
  ["闸机-东", "出门", "07:00:00"],
  ["闸机-东", "进门", "06:00:00"]
];

function swipeData(number = 1, mode = "normal", pageSize = 10) {
  const records = mode === 'empty' ? [] : mode === 'wide' ? [
    ...rows.slice(0, 3),
    ...Array.from({ length: 87 }, (_, i) => ['宿舍_道闸', '出门', `08:${String(59 - Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '00' : '30'}`]),
    ...rows.slice(-3)
  ] : rows;
  return {
    number, pageSize,
    total: mode === "changed" && number > 1 ? records.length + 1 : records.length,
    rows: records.slice((number - 1) * pageSize, number * pageSize)
  };
}

function swipeHtml(day = fixtureDay, { mode = 'normal', pageSize = 10, pageSizeControl = false, emptyCount = true } = {}) {
  return `<!doctype html><meta charset="utf-8">
    <form id="searchForm"><input name="pageNo" type="hidden"><input name="pageSize" type="hidden"></form>
    <table id="swipeRecordTable" class="layui-hide"></table>
    <div class="layui-table-view">
      <div class="layui-table-body layui-table-main"></div>
      <div class="layui-table-fixed"><table></table></div>
      <div class="layui-table-page"></div>
      <div class="layui-table-init" style="display:none">加载中</div>
    </div>
    <script>
    (() => {
      const fixtureDate = ${JSON.stringify(day)};
      function render(data) {
        const rowHtml = data.rows.map(([gate, direction, time]) => '<tr><td>' + gate + '</td><td>' + direction + '</td><td>' + fixtureDate + ' ' + time + '</td></tr>').join('');
        document.querySelector('.layui-table-main').innerHTML = '<table class="layui-table">' + rowHtml + '</table>' + (data.total === 0 ? '<div class="layui-none">暂无数据</div>' : '');
        // Fixed columns may clone rows; they must not be counted a second time.
        document.querySelector('.layui-table-fixed table').innerHTML = rowHtml;
        const limits = ${pageSizeControl} ? '<span class="layui-laypage-limits"><select>' + Array.from({length:9}, (_, i) => '<option value="' + ((i+1)*10) + '"' + (data.pageSize === (i+1)*10 ? ' selected' : '') + '>' + ((i+1)*10) + '条/页</option>').join('') + '</select></span>' : '';
        // A zero-result page deliberately keeps an inert, enabled next control.
        document.querySelector('.layui-table-page').innerHTML = '<div class="layui-box layui-laypage"><a href="javascript:;" class="layui-laypage-prev ' + (data.number === 1 ? 'layui-disabled' : '') + '" data-page="' + (data.number - 1) + '"><i></i></a><span class="layui-laypage-curr"><em></em><em>' + data.number + '</em></span><a href="javascript:;" class="layui-laypage-next ' + (data.total > 0 && data.number >= Math.ceil(data.total / data.pageSize) ? 'layui-disabled' : '') + '" data-page="' + (data.number + 1) + '"><i></i></a>' + (${emptyCount} || data.total > 0 ? '<span class="layui-laypage-count">共' + data.total + '条</span>' : '') + limits + '</div>';
        document.querySelector('.layui-table-init').style.display = 'none';
        async function load(number, size) {
          document.querySelector('.layui-laypage-curr em:last-child').textContent = number;
          document.querySelector('.layui-table-init').style.display = 'block';
          const target = new URL('/a/edu/acm/swipe/list', location.origin);
          target.searchParams.set('pageNo', number);
          target.searchParams.set('pageSize', size);
          const date = new URL(location.href).searchParams.get('swipeDate');
          if (date) target.searchParams.set('swipeDate', date);
          try {
            const response = await fetch(target);
            if (response.ok) render(await response.json());
          } catch {}
        }
        document.querySelector('.layui-laypage-limits select')?.addEventListener('change', event => load(1, Number(event.target.value)));
        document.querySelector('.layui-laypage-next').addEventListener('click', async event => {
          // Deliberately leave the javascript:; default action uncancelled.
          // The real portal may do this; the isolated reader must handle it.
          if (data.total === 0 || event.currentTarget.classList.contains('layui-disabled')) return;
          const number = Number(event.currentTarget.dataset.page);
          await load(number, data.pageSize);
        });
      }
      render(${JSON.stringify(swipeData(1, mode, pageSize))});
    })();
    </script>`;
}

module.exports = { fixtureDay, swipeData, swipeHtml };
