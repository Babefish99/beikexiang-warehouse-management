import { describe, expect, it } from "vitest";

import { ApprovalParser, type WeComApprovalPayload } from "../../../apps/api/src/infrastructure/wecom/approval-parser.js";

const makeDetail = (status = 2): WeComApprovalPayload => ({
  sp_no: "202607230021",
  sp_status: status,
  apply_time: 1784773140,
  applyer: { userid: "wx-zhangsan", name: "葛志俊", department: "行政和人资中心" },
  contents: [
    { control: "Text", title: "用途", value: { text: "外出考察" } },
    {
      control: "Table",
      title: "物品明细",
      value: {
        children: [
          {
            list: [
              { control: "Selector", title: "物品名称", value: { selector: { options: [{ key: "opt-powder", value: "盒装粉条" }] } } },
              { control: "Number", title: "数量", value: { new_number: { value: "4", unit: "包" } } },
            ],
          },
          {
            list: [
              { control: "Selector", title: "物品名称", value: { selector: { options: [{ key: "opt-tea", value: "茶叶" }] } } },
              { control: "Number", title: "数量", value: { new_number: { value: "4", unit: "盒" } } },
            ],
          },
          {
            list: [
              { control: "Selector", title: "物品名称", value: { selector: { options: [{ key: "opt-wine", value: "君品习酒，1935" }] } } },
              { control: "Number", title: "数量", value: { new_number: { value: "1", unit: "件" } } },
            ],
          },
        ],
      },
    },
  ],
});

describe("enterprise WeChat approval parser", () => {
  it("parses the live fixed-text item fields and resolves an item by its embedded code", () => {
    const detail: WeComApprovalPayload = {
      sp_no: "202609010007",
      sp_status: 2,
      apply_time: 1788224760,
      applyer: { userid: "zhangxinzhe8884", name: "张信哲", department: "行政和人资中心" },
      contents: [
        { control: "Text", title: "用途", value: { text: "系统上线联调测试，请审批后勿实际出库" } },
        { control: "Text", title: "物品1 名称", value: { text: "生产库现有联调物品 ACCEPT-61AD5B0-01" } },
        { control: "Text", title: "物品1 数量及单位", value: { text: "1" } },
        { control: "Text", title: "物品2 名称（如有）", value: { text: "无" } },
        { control: "Text", title: "物品2 数量及单位", value: { text: "无" } },
        { control: "Text", title: "物品3名称（如有）", value: { text: "无" } },
        { control: "Text", title: "物品3数量及单位", value: { text: "无" } },
      ],
    };
    const parser = new ApprovalParser((reference) => reference === "ACCEPT-61AD5B0-01"
      ? { id: "item-acceptance", code: reference, name: "生产库现有联调物品", unit: "件" }
      : undefined);

    expect(parser.parse(detail)).toMatchObject({
      weComSpNo: "202609010007",
      status: "APPROVED",
      purpose: "系统上线联调测试，请审批后勿实际出库",
      lines: [{
        itemId: "item-acceptance",
        itemOptionKey: "ACCEPT-61AD5B0-01",
        itemName: "生产库现有联调物品 ACCEPT-61AD5B0-01",
        requestedQuantity: "1",
        unit: "件",
      }],
    });
  });

  it("extracts applicant, purpose, and up to five item rows by option key", () => {
    const parser = new ApprovalParser((optionKey) => ({
      "opt-powder": { id: "item-1" },
      "opt-tea": { id: "item-2" },
      "opt-wine": { id: "item-3" },
    }[optionKey]));

    expect(parser.parse(makeDetail())).toMatchObject({
      weComSpNo: "202607230021",
      status: "APPROVED",
      applicantUserId: "wx-zhangsan",
      applicantName: "葛志俊",
      department: "行政和人资中心",
      purpose: "外出考察",
      lines: [
        { itemId: "item-1", itemOptionKey: "opt-powder", requestedQuantity: "4", unit: "包" },
        { itemId: "item-2", itemOptionKey: "opt-tea", requestedQuantity: "4", unit: "盒" },
        { itemId: "item-3", itemOptionKey: "opt-wine", requestedQuantity: "1", unit: "件" },
      ],
    });
  });

  it("maps non-approved statuses without producing an inventory-ready status", () => {
    const parser = new ApprovalParser(() => ({ id: "item-1" }));

    expect(parser.parse(makeDetail(3)).status).toBe("REJECTED");
    expect(parser.parse(makeDetail(4)).status).toBe("REVOKED");
    expect(parser.parse(makeDetail(6)).status).toBe("CANCELED");
  });

  it("rejects an unknown option key instead of matching by display name", () => {
    const parser = new ApprovalParser(() => undefined);

    expect(() => parser.parse(makeDetail())).toThrow("unknown item option key: opt-powder");
  });

  it("rejects an approval table with more than five rows", () => {
    const detail = makeDetail();
    const table = detail.contents.find((content) => content.control === "Table");
    if (!table || table.control !== "Table") throw new Error("fixture table missing");
    table.value.children = [...table.value.children, ...table.value.children, ...table.value.children].slice(0, 6);

    const parser = new ApprovalParser(() => ({ id: "item-1" }));
    expect(() => parser.parse(detail)).toThrow("approval cannot contain more than five item rows");
  });
});
