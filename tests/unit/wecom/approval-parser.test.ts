import { describe, expect, it } from "vitest";

import { ApprovalParser, type WeComApprovalPayload } from "../../../apps/api/src/infrastructure/wecom/approval-parser.js";

const makeDetail = (status = 2): WeComApprovalPayload => ({
  sp_no: "202607230021",
  template_id: "tpl-legacy-selector-v1",
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
  it("preserves fixed-text legacy facts without guessing a standard item", () => {
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
    const parser = new ApprovalParser(() => {
      throw new Error("fixed-text legacy rows must not resolve an item");
    });

    expect(parser.parse(detail)).toMatchObject({
      weComSpNo: "202609010007",
      status: "APPROVED",
      purpose: "系统上线联调测试，请审批后勿实际出库",
      lines: [{
        requestedItemName: "生产库现有联调物品 ACCEPT-61AD5B0-01",
        requestedQuantity: "1",
        unit: "",
        legacyResolutionStatus: "REAPPLY_REQUIRED",
      }],
    });
  });

  it("locks a mapped selector only when its unit and integer quantity exactly match", () => {
    const parser = new ApprovalParser((optionKey) => ({
      "opt-powder": { id: "item-1", unit: "包" },
      "opt-tea": { id: "item-2", unit: "盒" },
      "opt-wine": { id: "item-3", unit: "件" },
    }[optionKey]));

    expect(parser.parse(makeDetail())).toMatchObject({
      weComSpNo: "202607230021",
      status: "APPROVED",
      applicantUserId: "wx-zhangsan",
      applicantName: "葛志俊",
      department: "行政和人资中心",
      purpose: "外出考察",
      lines: [
        { itemId: "item-1", itemOptionKey: "opt-powder", requestedItemName: "盒装粉条", requestedQuantity: "4", unit: "包", legacyResolutionStatus: "EXACT_LOCKED" },
        { itemId: "item-2", itemOptionKey: "opt-tea", requestedItemName: "茶叶", requestedQuantity: "4", unit: "盒", legacyResolutionStatus: "EXACT_LOCKED" },
        { itemId: "item-3", itemOptionKey: "opt-wine", requestedItemName: "君品习酒，1935", requestedQuantity: "1", unit: "件", legacyResolutionStatus: "EXACT_LOCKED" },
      ],
    });
  });

  it("maps non-approved statuses without producing an inventory-ready status", () => {
    const parser = new ApprovalParser(() => ({ id: "item-1" }));

    expect(parser.parse(makeDetail(3)).status).toBe("REJECTED");
    expect(parser.parse(makeDetail(4)).status).toBe("REVOKED");
    expect(parser.parse(makeDetail(6)).status).toBe("CANCELED");
  });

  it("requires reapplication for an unknown selector instead of matching by display name", () => {
    const parser = new ApprovalParser(() => undefined);

    expect(parser.parse(makeDetail()).lines[0]).toMatchObject({
      requestedItemName: "盒装粉条",
      requestedQuantity: "4",
      unit: "包",
      legacyResolutionStatus: "REAPPLY_REQUIRED",
    });
    expect(parser.parse(makeDetail()).lines[0]?.itemId).toBeUndefined();
  });

  it("parses a new intent template without resolving a standard item", () => {
    const detail: WeComApprovalPayload = {
      sp_no: "202609040001",
      template_id: "tpl-intent-v2",
      sp_status: 2,
      apply_time: 1788516000,
      applyer: { userid: "wx-lisi", name: "李四" },
      contents: [
        { control: "Text", title: "用途", value: { text: "客户接待" } },
        {
          control: "Table",
          title: "物品明细",
          value: {
            children: [{
              list: [
                { control: "Text", title: "意向物品名称", value: { text: "招待用白酒" } },
                { control: "Number", title: "审批数量", value: { new_number: { value: "2" } } },
                { control: "Text", title: "单位", value: { text: "瓶" } },
                { control: "Textarea", title: "补充要求", value: { text: "用于接待" } },
              ],
            }],
          },
        },
      ],
    };
    const parser = new ApprovalParser(() => {
      throw new Error("new intent rows must not resolve an item");
    });

    expect(parser.parse(detail)).toMatchObject({
      sourceTemplateId: "tpl-intent-v2",
      lines: [{
        requestedItemName: "招待用白酒",
        requestedQuantity: "2",
        unit: "瓶",
        note: "用于接待",
        legacyResolutionStatus: "NOT_APPLICABLE",
      }],
    });
  });

  it.each([
    { fields: [{ control: "Number", title: "审批数量", value: { new_number: { value: "1.5" } } }], label: "fractional quantity" },
    { fields: [{ control: "Text", title: "单位", value: { text: "" } }], label: "missing unit" },
  ])("requires reapplication for a legacy selector with $label", ({ fields }) => {
    const detail = makeDetail();
    const table = detail.contents.find((content) => content.control === "Table");
    if (!table || table.control !== "Table") throw new Error("fixture table missing");
    table.value.children[0]!.list = [
      { control: "Selector", title: "物品名称", value: { selector: { options: [{ key: "opt-powder", value: "盒装粉条" }] } } },
      ...fields,
    ];

    const parser = new ApprovalParser(() => ({ id: "item-1", unit: "包" }));
    expect(parser.parse(detail).lines[0]).toMatchObject({ legacyResolutionStatus: "REAPPLY_REQUIRED" });
    expect(parser.parse(detail).lines[0]?.itemId).toBeUndefined();
  });

  it("requires reapplication for a legacy selector whose item unit differs", () => {
    const parser = new ApprovalParser(() => ({ id: "item-1", unit: "箱" }));

    expect(parser.parse(makeDetail()).lines[0]).toMatchObject({
      requestedItemName: "盒装粉条",
      requestedQuantity: "4",
      unit: "包",
      legacyResolutionStatus: "REAPPLY_REQUIRED",
    });
    expect(parser.parse(makeDetail()).lines[0]?.itemId).toBeUndefined();
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
