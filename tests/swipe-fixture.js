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

function swipeData(number = 1, mode = "normal") {
  return {
    number,
    total: mode === "changed" && number > 1 ? rows.length + 1 : rows.length,
    rows: rows.slice((number - 1) * 10, number * 10)
  };
}

function swipeHtml(day = fixtureDay) {
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
      const fixtureDate = ${JSON.stringify(day)};
      function render(data) {
        const rowHtml = data.rows.map(([gate, direction, time]) => '<tr><td>' + gate + '</td><td>' + direction + '</td><td>' + fixtureDate + ' ' + time + '</td></tr>').join('');
        document.querySelector('.layui-table-main').innerHTML = '<table class="layui-table">' + rowHtml + '</table>';
        // Fixed columns may clone rows; they must not be counted a second time.
        document.querySelector('.layui-table-fixed table').innerHTML = rowHtml;
        document.querySelector('.layui-table-page').innerHTML = '<div class="layui-box layui-laypage"><a href="javascript:;" class="layui-laypage-prev ' + (data.number === 1 ? 'layui-disabled' : '') + '" data-page="' + (data.number - 1) + '"><i></i></a><span class="layui-laypage-curr"><em></em><em>' + data.number + '</em></span><a href="javascript:;" class="layui-laypage-next ' + (data.number === 3 ? 'layui-disabled' : '') + '" data-page="' + (data.number + 1) + '"><i></i></a><span class="layui-laypage-count">共' + data.total + '条</span></div>';
        document.querySelector('.layui-table-init').style.display = 'none';
        document.querySelector('.layui-laypage-next').addEventListener('click', async event => {
          event.preventDefault();
          if (event.currentTarget.classList.contains('layui-disabled')) return;
          const number = Number(event.currentTarget.dataset.page);
          document.querySelector('.layui-laypage-curr em:last-child').textContent = number;
          document.querySelector('.layui-table-init').style.display = 'block';
          const target = new URL('/a/edu/acm/swipe/list', location.origin);
          target.searchParams.set('pageNo', number);
          try {
            const response = await fetch(target);
            if (response.ok) render(await response.json());
          } catch {}
        });
      }
      render(${JSON.stringify(swipeData())});
    </script>`;
}

module.exports = { fixtureDay, swipeData, swipeHtml };
