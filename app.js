<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover">
    <meta name="theme-color" content="#16213e">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <title>Семейный счетчик</title>
    <link rel="manifest" href="manifest.webmanifest">
    <link rel="stylesheet" href="./styles.css?v=176">
  </head>
  <body>
    <div id="bootErrorScreen" class="boot-error-screen boot-error-screen--loading">
      <div class="boot-error-card">
        <strong id="bootErrorTitle">Загрузка приложения…</strong>
        <span class="boot-error-hint">Если ошибка — текст появится ниже</span>
        <pre id="bootErrorLog" class="boot-error-log"></pre>
      </div>
    </div>
    <script>
      (function () {
        function bootLog(line) {
          var log = document.getElementById("bootErrorLog");
          var screen = document.getElementById("bootErrorScreen");
          var title = document.getElementById("bootErrorTitle");
          if (screen) {
            screen.classList.add("boot-error-screen--error");
            screen.classList.remove("boot-error-screen--loading");
          }
          if (title && title.textContent.indexOf("Ошибка") === -1) {
            title.textContent = "Ошибка запуска";
          }
          if (log) log.textContent += line + "\n";
        }
        window.__bootLog = bootLog;
        window.addEventListener("error", function (event) {
          bootLog(event.message || "ошибка JavaScript");
          if (event.error && event.error.stack) bootLog(event.error.stack);
        });
        window.addEventListener("unhandledrejection", function (event) {
          var reason = event.reason;
          var name = reason && reason.name ? String(reason.name) : "";
          var msg = String(reason && reason.message ? reason.message : reason);
          if (name === "AbortError" || /abort|aborted/i.test(msg)) return;
          if (/failed to fetch|networkerror|network request failed|load failed/i.test(msg)) return;
          bootLog(msg);
        });
        window.__scriptFailed = function (src) {
          bootLog("Не загрузился файл: " + src);
        };
        window.addEventListener("load", function () {
          var bodyBg = window.getComputedStyle(document.body).backgroundColor;
          if (bodyBg === "rgb(255, 255, 255)" || bodyBg === "white") {
            bootLog("Стили не загрузились — залейте styles.css на сайт (UTF-8) и обновите до вер. 110");
          }
        });
      })();
    </script>
    <div class="bot-pending-banner bot-notice-legacy" id="botPendingBanner" hidden aria-hidden="true"></div>
    <div class="bot-success-banner bot-notice-legacy" id="botSuccessBanner" hidden aria-hidden="true"></div>
    <div class="sync-alert-banner bot-notice-legacy" id="syncAlertBanner" hidden aria-hidden="true"></div>
    <div class="app">
      <main>
        <section class="card top-bar">
          <div class="top-bar-row">
            <div class="top-metric">
              <span class="top-label">Баланс</span>
              <strong id="familyTotal">0</strong>
              <button type="button" class="top-subtotal day-link income" id="familyIncomeToday" data-day-metric="income">сегодня 0</button>
            </div>
            <div class="top-metric">
              <span class="top-label">Траты</span>
              <strong id="familyPurchaseTotal" class="purchase">0</strong>
              <button type="button" class="top-subtotal day-link" id="familyPurchaseToday" data-day-metric="purchase">сегодня 0</button>
            </div>
            <div class="top-metric">
              <span class="top-label">Переводы</span>
              <strong id="familyTransferTotal" class="transfer">0</strong>
              <button type="button" class="top-subtotal day-link transfer" id="familyTransferToday" data-day-metric="transfer">сегодня 0</button>
            </div>
            <div class="top-bar-actions">
              <button class="ghost compact" type="button" id="detailsToggleButton">Подробней</button>
              <button class="ghost compact" type="button" id="historyToggleButton">История</button>
              <button class="ghost compact" type="button" id="addListButton">+ Список</button>
              <button class="primary compact" type="button" id="addPersonButton">+ Карта</button>
            </div>
          </div>
          <div class="sync-row">
            <div class="sync-notice-row" id="syncNoticeRow" hidden>
              <span id="syncNoticeText"></span>
            </div>
            <div class="sync-actions-row">
              <span class="sync-status" id="syncStatus" data-status="local">Только этот телефон</span>
              <span class="app-version" id="appVersion"></span>
            </div>
          </div>
        </section>

        <div id="mainView">
        <section class="card stats-card stats-card-top">
          <div class="stats-grid">
            <div>
              <span class="stats-label">Пополнений</span>
              <strong id="incomeCount">0</strong>
            </div>
            <div>
              <span class="stats-label">Покупок</span>
              <strong id="purchaseCount">0</strong>
            </div>
            <div>
              <span class="stats-label">Переводов</span>
              <strong id="transferCount">0</strong>
            </div>
          </div>
        </section>

        <section class="card folder-card">
          <div class="banks-bar">
            <span class="inline-label">Банки</span>
            <div class="folder-list folder-list-flow" id="folderList" aria-label="Банки-фильтры"></div>
            <div class="banks-controls">
              <span class="single-filter-text">1 фильтр</span>
              <button class="toggle-chip" type="button" id="singleFilterToggle" aria-label="Только один фильтр">🚫</button>
              <button class="ghost mini" type="button" id="deleteFolderButton" aria-label="Удалить банк">−</button>
              <button class="ghost mini" type="button" id="addFolderButton" aria-label="Добавить банк">+</button>
            </div>
          </div>
          <div class="folder-row">
            <span class="inline-label">Имена</span>
            <div class="folder-list" id="firstNameFilterList" aria-label="Фильтр по имени"></div>
          </div>
          <div class="people-controls">
            <div class="people-balance-filter">
              <span class="inline-label">Баланс</span>
              <input id="balanceMinInput" type="number" inputmode="numeric" step="100" placeholder="от" aria-label="Баланс от">
              <input id="balanceMaxInput" type="number" inputmode="numeric" step="100" placeholder="до" aria-label="Баланс до">
            </div>
            <div class="people-sort">
              <span class="inline-label">Сорт.</span>
              <select id="peopleSortSelect" aria-label="Сортировка людей">
                <option value="manual">Свой порядок</option>
                <option value="balance-desc">Крупный баланс</option>
                <option value="balance-asc">Мелкий баланс</option>
                <option value="purchases-all">Больше покупок (всего)</option>
                <option value="purchases-since">Больше покупок с пополнения</option>
              </select>
            </div>
          </div>
        </section>

        <section class="people" id="peopleList" aria-label="Список людей"></section>
        </div>

        <section class="card details-card" id="detailsView" hidden>
          <div class="section-title details-head">
            <div>
              <span class="label">Подробно</span>
              <h2>Все карты</h2>
            </div>
          </div>
          <section class="people" id="detailsPeopleList" aria-label="Подробный список людей"></section>
          <div class="details-copy-all" id="detailsCopyAll">
            <span class="inline-label">Все люди</span>
            <div class="person-copy-actions details-copy-actions">
              <button type="button" class="copy-chip" data-copy-all="phone">Телефон</button>
              <button type="button" class="copy-chip" data-copy-all="card">Карта</button>
              <button type="button" class="copy-chip" data-copy-all="phone-card">Тел+карта</button>
              <button type="button" class="copy-chip" data-copy-all="brief">Краткие данные</button>
              <button type="button" class="copy-chip" data-copy-all="full">Все данные</button>
            </div>
          </div>
        </section>

        <section class="card history-card" id="historyView" hidden>
          <div class="section-title">
            <div>
              <span class="label">История</span>
              <h2>Все операции</h2>
            </div>
            <div class="history-actions">
              <button class="ghost" type="button" id="historyDetailsToggle">Подробнее</button>
            </div>
          </div>

          <div id="historyControls" hidden>
            <div class="history-actions history-actions-secondary">
              <select id="historyPeriodSelect" class="history-period-select" aria-label="Период истории">
                <option value="current">Текущий период</option>
              </select>
              <button class="ghost" type="button" id="nextMonthButton">След. месяц</button>
              <button class="ghost" type="button" id="clearHistoryButton">Очистить</button>
            </div>

            <div class="filters">
              <select id="personFilter" aria-label="Фильтр по имени"></select>
              <select id="typeFilter" aria-label="Фильтр по разделу">
                <option value="all">Все разделы</option>
                <option value="income">Пополнения</option>
                <option value="purchase">Покупки</option>
                <option value="transfer">Переводы</option>
              </select>
            </div>
            <label class="history-comment-filter">
              <span class="label">Поиск по комментарию</span>
              <input
                id="commentFilter"
                type="search"
                aria-label="Поиск по комментарию"
                placeholder="Например: Магазин"
                autocomplete="off"
              >
            </label>
            <div class="history-date-filter">
              <label>
                <span class="label">С даты</span>
                <input id="historyDateFrom" type="date" aria-label="История с даты">
              </label>
              <label>
                <span class="label">По дату</span>
                <input id="historyDateTo" type="date" aria-label="История по дату">
              </label>
              <button class="ghost mini" type="button" id="historyDateReset" aria-label="Сбросить даты">Сброс</button>
            </div>
            <div class="history-amount-filter">
              <label>
                <span class="label">Сумма от</span>
                <input id="historyAmountFrom" type="number" inputmode="decimal" placeholder="от" aria-label="Сумма от">
              </label>
              <label>
                <span class="label">до</span>
                <input id="historyAmountTo" type="number" inputmode="decimal" placeholder="до" aria-label="Сумма до">
              </label>
              <button class="ghost mini" type="button" id="historyAmountReset" aria-label="Сбросить суммы">Сброс</button>
            </div>

            <div class="tabs" role="tablist" aria-label="Быстрый фильтр истории">
              <button class="tab active" data-type="all">Все</button>
              <button class="tab" data-type="income">Пополнения</button>
              <button class="tab" data-type="purchase">Покупки</button>
              <button class="tab" data-type="transfer">Переводы</button>
            </div>
          </div>

          <div class="history-list" id="historyList"></div>
        </section>
      </main>
    </div>

    <dialog id="personDialog">
      <form method="dialog" class="dialog-card" id="personForm">
        <h2 id="personDialogTitle">Добавить карту</h2>
        <label>
          Имя
          <input id="personFirstNameInput" autocomplete="off" maxlength="32" placeholder="Например: Саня" required>
        </label>
        <label>
          Фамилия
          <input id="personLastNameInput" autocomplete="off" maxlength="32" placeholder="Необязательно">
        </label>
        <label>
          Начальная сумма
          <input id="personBalanceInput" inputmode="decimal" placeholder="0">
        </label>
        <label>
          Телефон
          <input id="personPhoneInput" type="text" inputmode="text" autocomplete="off" maxlength="24" placeholder="Необязательно">
        </label>
        <label>
          Номер карты
          <input id="personCardNumberInput" autocomplete="off" maxlength="32" placeholder="Необязательно">
        </label>
        <label>
          Данные к карте
          <input id="personCardDetailsInput" autocomplete="off" maxlength="128" placeholder="Банк, Сбер, Озон…">
        </label>
        <label>
          Комментарий
          <input id="personProfileNoteInput" autocomplete="off" maxlength="120" placeholder="Необязательно">
        </label>
        <div class="bank-theme-picker-block card-tint-picker-block">
          <div class="bank-theme-picker card-tint-picker" id="personCardTintPicker" role="group" aria-label="Банк"></div>
        </div>
        <div class="folder-picker-block">
          <span class="label">Папки</span>
          <div class="folder-picker" id="personFolderPicker"></div>
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="personUseInBotCheckbox">
          Использовать в боте (умные переменные)
        </label>
        <p class="muted sync-hint person-bot-hint">Группа настраивается в админ-боте: 📱 Приложение. ID группы в приложении не нужен.</p>
        <div class="dialog-actions">
          <button class="ghost" value="cancel" type="button" id="cancelPersonButton">Отмена</button>
          <button class="primary" value="default">Сохранить</button>
        </div>
        <button class="danger person-delete-bottom" type="button" id="deletePersonButton" hidden>Удалить карту</button>
        <div class="person-sync-code-block">
          <button class="ghost mini" type="button" id="openSyncFromPersonButton">Код семьи</button>
        </div>
      </form>
    </dialog>

    <dialog id="folderDialog">
      <form method="dialog" class="dialog-card" id="folderForm">
        <h2>Добавить папку</h2>
        <label>
          Название папки
          <input id="folderNameInput" autocomplete="off" maxlength="32" placeholder="Например: Мальчики ✅" required>
        </label>
        <div class="dialog-actions">
          <button class="ghost" value="cancel" type="button" id="cancelFolderButton">Отмена</button>
          <button class="primary" value="default">Сохранить</button>
        </div>
      </form>
    </dialog>

    <dialog id="deleteFolderDialog">
      <form method="dialog" class="dialog-card" id="deleteFolderForm">
        <h2>Удалить папку</h2>
        <label>
          Какая папка
          <select id="deleteFolderSelect" required></select>
        </label>
        <div class="dialog-actions">
          <button class="ghost" value="cancel" type="button" id="cancelDeleteFolderButton">Отмена</button>
          <button class="danger" value="default">Удалить</button>
        </div>
      </form>
    </dialog>

    <dialog id="operationDialog">
      <form method="dialog" class="dialog-card operation-dialog" id="operationForm">
        <div class="section-title">
          <div>
            <span class="label" id="operationPerson">Имя</span>
            <h2 id="operationTitle">Операция</h2>
          </div>
          <button class="ghost" type="button" id="cancelOperationButton">Выйти</button>
        </div>

        <label class="amount-preview amount-preview-input">
          <span>Сумма</span>
          <input
            id="selectedAmountInput"
            type="text"
            inputmode="decimal"
            enterkeyhint="done"
            autocomplete="off"
            placeholder="0"
            aria-label="Сумма"
          >
        </label>

        <label>
          Комментарий
          <input id="noteInput" maxlength="80" placeholder="Например: продукты, школа, такси">
        </label>

        <div class="operation-action-grid">
          <button type="button" class="op-action op-purchase" data-op="purchase">Покупка</button>
          <button type="button" class="op-action op-transfer" data-op="transfer">Перевод</button>
          <button type="button" class="op-action op-income" data-op="income">Пополнение</button>
        </div>

        <div class="dialog-actions operation-dialog-actions">
          <button class="ghost" type="button" id="exitOperationButton">Выйти</button>
          <button class="danger" type="button" id="resetAmountButton">Сбросить</button>
        </div>
        <input type="checkbox" id="transferCheckbox" hidden>
        <button type="submit" id="confirmOperationButton" hidden aria-hidden="true"></button>
      </form>
    </dialog>

    <dialog id="historyEditDialog">
      <form method="dialog" class="dialog-card operation-dialog" id="historyEditForm">
        <div class="section-title">
          <div>
            <span class="label" id="historyEditPerson">Имя</span>
            <h2 id="historyEditTitle">Операция</h2>
          </div>
          <button class="ghost" type="button" id="cancelHistoryEditButton">Выйти</button>
        </div>

        <label class="amount-preview amount-preview-input">
          <span id="historyEditAmountLabel">Сумма</span>
          <input
            id="historyEditAmountInput"
            type="text"
            inputmode="decimal"
            enterkeyhint="done"
            autocomplete="off"
            placeholder="0"
            aria-label="Сумма операции"
          >
        </label>

        <label>
          Комментарий
          <input id="historyEditNoteInput" maxlength="80" placeholder="Например: продукты, школа">
        </label>

        <div class="operation-action-grid" id="historyEditTypeGrid">
          <button type="button" class="op-action op-purchase" data-htype="purchase">Покупка</button>
          <button type="button" class="op-action op-transfer" data-htype="transfer">Перевод</button>
          <button type="button" class="op-action op-income" data-htype="income">Пополнение</button>
        </div>

        <div class="dialog-actions operation-dialog-actions">
          <button class="ghost" type="button" id="exitHistoryEditButton">Выйти</button>
          <button class="danger" type="button" id="deleteHistoryEditButton">Удалить</button>
          <button class="primary" type="button" id="saveHistoryEditButton">Сохранить</button>
        </div>
      </form>
    </dialog>

    <dialog id="dayHistoryDialog">
      <form method="dialog" class="dialog-card">
        <div class="section-title">
          <div>
            <span class="label" id="dayHistoryLabel">По дням</span>
            <h2 id="dayHistoryTitle">История дней</h2>
          </div>
          <button class="ghost" type="button" id="cancelDayHistoryButton">Закрыть</button>
        </div>
        <div class="day-history-list" id="dayHistoryList"></div>
      </form>
    </dialog>

    <dialog id="bulkListDialog">
      <form method="dialog" class="dialog-card bulk-dialog" id="bulkListForm">
        <div class="section-title">
          <div>
            <span class="label">Списком</span>
            <h2>Добавить список</h2>
          </div>
          <button class="ghost" type="button" id="cancelBulkListButton">Выйти</button>
        </div>

        <div id="bulkStepInput">
          <p class="muted sync-hint">Каждая строка: имя (примерно) и сумма в конце. Enter — новая строка.<br>Например: <b>виктор цуп 367</b></p>
          <textarea id="bulkListInput" class="bulk-textarea" rows="7" placeholder="виктор цуп 367&#10;викт озон 899&#10;люд тиньк 6000" autocomplete="off"></textarea>
          <div class="dialog-actions">
            <button class="ghost" type="button" id="bulkCancelButton2">Выйти</button>
            <button class="primary" type="button" id="bulkRecognizeButton">Распознать</button>
          </div>
        </div>

        <div id="bulkStepMatch" hidden>
          <p class="muted sync-hint" id="bulkMatchHint">Отметьте нужного человека в каждой строке, затем выберите тип операции.</p>
          <div class="bulk-match-list" id="bulkMatchList"></div>
          <div class="operation-action-grid" id="bulkTypeGrid">
            <button type="button" class="op-action op-purchase" data-htype="purchase">Покупка</button>
            <button type="button" class="op-action op-transfer" data-htype="transfer">Перевод</button>
            <button type="button" class="op-action op-income" data-htype="income">Пополнение</button>
          </div>
          <div class="dialog-actions">
            <button class="ghost" type="button" id="bulkBackButton">Назад</button>
          </div>
        </div>
      </form>
    </dialog>

    <dialog id="syncDialog">
      <form method="dialog" class="dialog-card" id="syncForm">
        <h2>Синхронизация</h2>
        <p class="muted sync-hint" id="syncModeHint">Синхронизация через Telegram. Телефон и сайт на ПК связаны только через канал — один код семьи и запущенный main.py на компьютере.</p>
        <label class="telegram-sync-field">
          Токен бота
          <input id="telegramBotTokenInput" autocomplete="off" placeholder="123456:ABC...">
        </label>
        <label class="telegram-sync-field">
          ID канала
          <input id="telegramChatIdInput" autocomplete="off" placeholder="-1001234567890">
        </label>
        <label class="telegram-sync-field">
          Секрет синхронизации
          <input id="telegramSecretInput" autocomplete="off" placeholder="Один на всю семью">
        </label>
        <label class="pc-sync-field" hidden>
          Адрес ПК (бот)
          <input id="serverUrlInput" autocomplete="off" placeholder="http://192.168.1.100:8767">
        </label>
        <label>
          Код семьи
          <input id="familyCodeInput" autocomplete="off" maxlength="8" placeholder="Например: ABC123" required>
        </label>
        <p class="muted sync-hint">Группа умных переменных настраивается в админ-боте (📱 Приложение). «В боте»: человек 1 → значение 1, человек 3 → значение 3; если в боте уже есть строки 1–5, новые пойдут в 6, 7, 8…</p>
        <button class="ghost" type="button" id="createFamilyCodeButton">Создать новый код</button>
        <div class="sync-danger-zone">
          <p class="muted sync-hint">Если после синхронизации возвращаются старые карты — очистите данные.</p>
          <button class="ghost danger-text" type="button" id="clearLocalDataButton">Очистить только на телефоне</button>
          <button class="ghost danger-text" type="button" id="clearCloudDataButton">Очистить телефон и облако Telegram</button>
        </div>
        <div class="dialog-actions">
          <button class="ghost" type="button" id="cancelSyncButton">Отмена</button>
          <button class="primary" value="default">Сохранить</button>
        </div>
      </form>
    </dialog>

    <dialog id="botOfflineDialog">
      <form method="dialog" class="dialog-card">
        <h2>Синхронизация недоступна</h2>
        <p class="dialog-hint">
          Telegram не отвечает (блокировка API, неверный токен, бот не в канале).
          Для пополнений и трат main.py не нужен — данные идут через sync-бот в канал.
          Отложить запрос в бот ПК?
        </p>
        <div class="dialog-actions">
          <button type="submit" class="ghost" value="cancel">Отменить</button>
          <button type="submit" class="primary" value="confirm">Да</button>
        </div>
      </form>
    </dialog>

    <template id="emptyStateTemplate">
      <div class="empty-state">
        <strong>Пока пусто</strong>
        <span>Добавьте карту и начните вести пополнения или траты.</span>
      </div>
    </template>

    <button class="icon-button" id="installButton" hidden>Установить</button>
    <script src="server-config.js?v=176" onerror="window.__scriptFailed('server-config.js')"></script>
    <script src="telegram-config.js?v=176" onerror="window.__scriptFailed('telegram-config.js')"></script>
    <script src="firebase-config.js?v=176" onerror="window.__scriptFailed('firebase-config.js')"></script>
    <script src="telegram-crypto.js?v=176" onerror="window.__scriptFailed('telegram-crypto.js')"></script>
    <script src="sync-merge.js?v=176" onerror="window.__scriptFailed('sync-merge.js')"></script>
    <script src="sync.js?v=176" onerror="window.__scriptFailed('sync.js')"></script>
    <script src="sync-telegram.js?v=176" onerror="window.__scriptFailed('sync-telegram.js')"></script>
    <script src="sync-firebase.js?v=176" onerror="window.__scriptFailed('sync-firebase.js')"></script>
    <script src="app.js?v=176" defer onerror="window.__scriptFailed('app.js')"></script>
  </body>
</html>
