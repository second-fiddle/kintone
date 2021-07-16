(() => {
  "use strict";

  /**
   * 電子印管理アプリID
   */
  const YOUR_DOMAIN = "your-domain";
  /**
   * 電子印管理アプリID
   */
  const STAMP_APP_ID = 6;
  /**
   * 電子印管理アプリの社員名を表すフィールドコード
   */
  const STAMP_USER_CODE_FIELD_CD = "承認者";

  /**
   * 印鑑未登録例外
   */
  class UserStampNotFoundError extends Error {
    constructor(message = "") {
      super(message);
      this.name = "UserStampNotFoundError";
    }
  }

  // 印鑑情報を取得する。
  const getUserStamp = async (userCode) => {
    const query = {
      app: STAMP_APP_ID,
      query: `${STAMP_USER_CODE_FIELD_CD} in ("${userCode}")`,
    };
    const stampRecords = await kintone.api(
      kintone.api.url("/k/v1/records.json", true),
      "GET",
      query
    );
    if (stampRecords.records.length === 0) {
      throw new UserStampNotFoundError();
    }
    return stampRecords.records[0];
  };

  // 詳細画面、追加画面、更新画面表示時
  kintone.events.on(
    [
      "app.record.detail.show",
      "app.record.create.show",
      "app.record.edit.show",
    ],
    async (event) => {
      // プロセス管理の設定を取得する。
      const processDefine = await kintone.api(
        kintone.api.url("/k/v1/app/status.json", true),
        "GET",
        { app: kintone.app.getId() }
      );
      if (!processDefine.enable) {
        Swal.fire({
          icon: "error",
          title: "プロセス設定未定義エラー",
          html: `プロセス設定が設定されていません。<br>電子印を使用する場合、プロセス設定を行ってください。`,
        });

        return event;
      }
      const processNames = processDefine.actions.map((action) => action.to);

      // 承認印添付ファイルフィールドにスタイルを適用する。
      const attachFileFields = Object.values(
        cybozu.data.page.FORM_DATA.schema.table.fieldList
      ).filter((value) => processNames.includes(value.var));
      attachFileFields.forEach((field) => {
        const element = document.getElementsByClassName(`field-${field.id}`);
        if (element.length === 0) {
          return event;
        }
        element[0].classList.add("approval-stamp-field");
      });

      return event;
    }
  );
  // プロセス管理アクション実行時
  kintone.events.on(["app.record.detail.process.proceed"], async (event) => {
    const nStatus = event.nextStatus.value;

    // プロセス名に対応する項目がレコードにない場合、処理しない
    if (!event.record[nStatus]) {
      return event;
    }

    // 以下、承認印処理
    const record = event.record;
    // 印鑑情報取得
    let stampRecord;
    try {
      stampRecord = await getUserStamp(record.更新者.value.code);
    } catch (usnfE) {
      Swal.fire({
        icon: "error",
        title: "電子印未登録",
        html: `承認者(${record.更新者.value.name})の電子印が登録されていません。<br>印鑑設定で電子印を登録後、再度実行してください。`,
        footer: `<a href="https://${YOUR_DOMAIN}.cybozu.com/k/${STAMP_APP_ID}/" target="_blank">印鑑設定はこちら</a>`,
      });

      return false;
    }

    // ファイルダウンロード
    const fileDownloadKey = {
      fileKey: stampRecord.承認印.value[0].fileKey,
    };
    const fileDownloadUrl = kintone.api.urlForGet(
      "/k/v1/file",
      fileDownloadKey,
      true
    );
    const downloadXhr = new XMLHttpRequest();
    downloadXhr.open("GET", fileDownloadUrl);
    downloadXhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
    downloadXhr.responseType = "blob";
    downloadXhr.onload = () => {
      if (downloadXhr.status !== 200) {
        return;
      }
      // ファイルアップロード
      const formData = new FormData();
      formData.append("__REQUEST_TOKEN__", kintone.getRequestToken());
      formData.append(
        "file",
        new Blob([downloadXhr.response]),
        stampRecord.承認印.value[0].name
      );

      const uploadXhr = new XMLHttpRequest();
      uploadXhr.open("POST", kintone.api.url("/k/v1/file", true), false);
      uploadXhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
      uploadXhr.responseType = "multipart/form-data";
      uploadXhr.onload = async () => {
        if (uploadXhr.status !== 200) {
          return;
        }
        const key = JSON.parse(uploadXhr.responseText).fileKey;
        const json = {
          app: kintone.app.getId(),
          id: kintone.app.record.getId(),
          record: {
            [nStatus]: {
              value: [{ fileKey: key }],
            },
          },
        };
        await kintone.api(kintone.api.url("/k/v1/record", true), "PUT", json);
        // 非同期のため印鑑画像の表示がうまくいかない時があるため、リロード
        location.reload();
      };
      uploadXhr.send(formData);
    };
    downloadXhr.send();

    return event;
  });
})();
