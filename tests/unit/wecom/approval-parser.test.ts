import { describe, expect, it } from "vitest";

import { createApprovalParser } from "../../../apps/api/src/server.js";
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
      "opt-powder": { id: "item-1", unit: "包", isActive: true },
      "opt-tea": { id: "item-2", unit: "盒", isActive: true },
      "opt-wine": { id: "item-3", unit: "件", isActive: true },
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

  it("keeps the primary template on the legacy selector path during the compatible first deployment", () => {
    const parser = createApprovalParser((optionKey) => ({
      "opt-powder": { id: "item-1", unit: "包", isActive: true },
      "opt-tea": { id: "item-2", unit: "盒", isActive: true },
      "opt-wine": { id: "item-3", unit: "件", isActive: true },
    }[optionKey]), {
      approvalTemplateId: "tpl-legacy-selector-v1",
      approvalTemplateIds: ["tpl-legacy-selector-v1"],
    });

    expect(parser.parse(makeDetail()).lines).toMatchObject([
      { itemId: "item-1", legacyResolutionStatus: "EXACT_LOCKED" },
      { itemId: "item-2", legacyResolutionStatus: "EXACT_LOCKED" },
      { itemId: "item-3", legacyResolutionStatus: "EXACT_LOCKED" },
    ]);
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
    }, "tpl-intent-v2");

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

  it("allows a compatible legacy selector approval without a purpose", () => {
    const detail = makeDetail();
    detail.contents = detail.contents.filter((content) => content.control === "Table" || content.title !== "用途");

    const parsed = new ApprovalParser((optionKey) => (
      optionKey === "opt-powder" ? { id: "item-1", unit: "包", isActive: true } : undefined
    )).parse(detail);

    expect(parsed).toMatchObject({
      purpose: "",
    });
    expect(parsed.lines[0]).toMatchObject({ itemId: "item-1", legacyResolutionStatus: "EXACT_LOCKED" });
  });

  it("rejects an empty or whitespace-only purpose on the intent template", () => {
    const detail: WeComApprovalPayload = {
      sp_no: "202609040012",
      template_id: "tpl-intent-v2",
      sp_status: 2,
      apply_time: 1788516000,
      applyer: { userid: "wx-lisi", name: "李四" },
      contents: [
        { control: "Text", title: "用途", value: { text: "  \u3000 " } },
        { control: "Table", title: "物品明细", value: { children: [{ list: [
          { control: "Text", title: "意向物品名称", value: { text: "招待用白酒" } },
          { control: "Number", title: "审批数量", value: { new_number: { value: "2" } } },
          { control: "Text", title: "单位", value: { text: "瓶" } },
        ] }] } },
      ],
    };

    expect(() => new ApprovalParser(() => undefined, "tpl-intent-v2").parse(detail)).toThrow("approval purpose is required");
  });

  it("rejects an intent-shaped row with required fields missing instead of falling back to legacy parsing", () => {
    const detail: WeComApprovalPayload = {
      sp_no: "202609040010",
      template_id: "tpl-new-template",
      sp_status: 2,
      apply_time: 1788516000,
      applyer: { userid: "wx-lisi", name: "李四" },
      contents: [
        { control: "Text", title: "用途", value: { text: "客户接待" } },
        {
          control: "Table",
          title: "物品明细",
          value: { children: [{ list: [
            { control: "Text", title: "意向物品名称", value: { text: "招待用白酒" } },
          ] }] },
        },
      ],
    };

    expect(() => new ApprovalParser(() => undefined).parse(detail)).toThrow("approval quantity must be a positive integer");
  });

  it.each([
    ["意向物品名称", "approval requested item name is required"],
    ["审批数量", "approval quantity must be a positive integer"],
    ["单位", "approval unit is required"],
  ])("rejects a new intent row missing required field %s", (missingTitle, expectedError) => {
    const fields = [
      { control: "Text", title: "意向物品名称", value: { text: "招待用白酒" } },
      { control: "Number", title: "审批数量", value: { new_number: { value: "2" } } },
      { control: "Text", title: "单位", value: { text: "瓶" } },
      { control: "Textarea", title: "补充要求", value: { text: "用于接待" } },
    ].filter((field) => field.title !== missingTitle);
    const detail: WeComApprovalPayload = {
      sp_no: "202609040011",
      template_id: "tpl-new-template",
      sp_status: 2,
      apply_time: 1788516000,
      applyer: { userid: "wx-lisi", name: "李四" },
      contents: [
        { control: "Text", title: "用途", value: { text: "客户接待" } },
        { control: "Table", title: "物品明细", value: { children: [{ list: fields }] } },
      ],
    };

    expect(() => new ApprovalParser(() => undefined).parse(detail)).toThrow(expectedError);
  });

  it("keeps an allow-listed legacy template on the legacy parser path even when field titles resemble intent fields", () => {
    const detail = makeDetail();
    const table = detail.contents.find((content) => content.control === "Table");
    if (!table || table.control !== "Table") throw new Error("fixture table missing");
    table.value.children[0]!.list[0]!.title = "意向物品名称";
    table.value.children[0]!.list[1]!.title = "审批数量";
    table.value.children[0]!.list.push({ control: "Text", title: "单位", value: { text: "包" } });
    table.value.children = [table.value.children[0]!];
    const parser = new ApprovalParser(() => ({ id: "item-1", unit: "包", isActive: true }), "tpl-intent-v2");

    expect(parser.parse(detail).lines).toEqual([{
      itemId: "item-1",
      itemOptionKey: "opt-powder",
      requestedItemName: "盒装粉条",
      requestedQuantity: "4",
      unit: "包",
      legacyResolutionStatus: "EXACT_LOCKED",
    }]);
  });

  it("treats a configured intent template as strict intent even when a selector makes the row hybrid", () => {
    const detail = makeDetail();
    detail.template_id = "tpl-intent-v2";
    const table = detail.contents.find((content) => content.control === "Table");
    if (!table || table.control !== "Table") throw new Error("fixture table missing");
    table.value.children = [table.value.children[0]!];
    table.value.children[0]!.list[0]!.title = "意向物品名称";
    table.value.children[0]!.list[1]!.title = "审批数量";
    table.value.children[0]!.list.push({ control: "Text", title: "单位", value: { text: "包" } });

    const parser = createApprovalParser(() => ({ id: "item-must-not-bind", unit: "包", isActive: true }), {
      approvalTemplateId: "tpl-intent-v2",
      approvalTemplateIds: ["tpl-intent-v2", "tpl-legacy-selector-v1"],
    });

    expect(() => parser.parse(detail)).toThrow("approval requested item name is required");
  });

  it.each([
    { fields: [{ control: "Number", title: "数量", value: { new_number: { value: "1.5", unit: "包" } } }], label: "fractional quantity" },
    { fields: [{ control: "Number", title: "数量", value: { new_number: { value: "4" } } }], label: "missing unit" },
  ])("requires reapplication for a legacy selector with $label", ({ fields }) => {
    const detail = makeDetail();
    const table = detail.contents.find((content) => content.control === "Table");
    if (!table || table.control !== "Table") throw new Error("fixture table missing");
    table.value.children[0]!.list = [
      { control: "Selector", title: "物品名称", value: { selector: { options: [{ key: "opt-powder", value: "盒装粉条" }] } } },
      ...fields,
    ];

    const parser = new ApprovalParser(() => ({ id: "item-1", unit: "包", isActive: true }));
    expect(parser.parse(detail).lines[0]).toMatchObject({ legacyResolutionStatus: "REAPPLY_REQUIRED" });
    expect(parser.parse(detail).lines[0]?.itemId).toBeUndefined();
  });

  it("requires reapplication for a legacy selector whose item unit differs", () => {
    const parser = new ApprovalParser(() => ({ id: "item-1", unit: "箱", isActive: true }));

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

  it("requires reapplication when a selector has multiple selected options", () => {
    const detail = makeDetail();
    const table = detail.contents.find((content) => content.control === "Table");
    if (!table || table.control !== "Table") throw new Error("fixture table missing");
    table.value.children[0]!.list[0] = {
      control: "Selector",
      title: "物品名称",
      value: { selector: { options: [
        { key: "opt-powder", value: "盒装粉条" },
        { key: "opt-tea", value: "茶叶" },
      ] } },
    };
    const parser = new ApprovalParser(() => ({ id: "item-1", unit: "包", isActive: true }));

    const line = parser.parse(detail).lines[0]!;
    expect(line.legacyResolutionStatus).toBe("REAPPLY_REQUIRED");
    expect(line.itemId).toBeUndefined();
    expect(line.itemOptionKey).toBeUndefined();
  });

  it("requires reapplication when a selector maps to an inactive item", () => {
    const parser = new ApprovalParser(() => ({ id: "item-1", unit: "包", isActive: false }));

    const line = parser.parse(makeDetail()).lines[0]!;
    expect(line.legacyResolutionStatus).toBe("REAPPLY_REQUIRED");
    expect(line.itemId).toBeUndefined();
    expect(line.itemOptionKey).toBeUndefined();
  });

  it("rejects an empty legacy item table", () => {
    const detail = makeDetail();
    const table = detail.contents.find((content) => content.control === "Table");
    if (!table || table.control !== "Table") throw new Error("fixture table missing");
    table.value.children = [];

    expect(() => new ApprovalParser(() => undefined).parse(detail)).toThrow("approval must contain between one and five substantive item rows");
  });

  it("rejects fixed-text approvals without a substantive item", () => {
    const detail: WeComApprovalPayload = {
      sp_no: "202609040002",
      sp_status: 2,
      apply_time: 1788516000,
      applyer: { userid: "wx-lisi", name: "李四" },
      contents: [
        { control: "Text", title: "用途", value: { text: "客户接待" } },
        { control: "Text", title: "物品1 名称", value: { text: "无" } },
      ],
    };

    expect(() => new ApprovalParser(() => undefined).parse(detail)).toThrow("approval must contain between one and five substantive item rows");
  });

  it("recognizes a configured intent template with a missing required item name", () => {
    const detail: WeComApprovalPayload = {
      sp_no: "202609040003",
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
            children: [{ list: [
              { control: "Number", title: "审批数量", value: { new_number: { value: "2" } } },
              { control: "Text", title: "单位", value: { text: "瓶" } },
              { control: "Textarea", title: "补充要求", value: { text: "用于接待" } },
            ] }],
          },
        },
      ],
    };

    expect(() => new ApprovalParser(() => {
      throw new Error("intent rows must not resolve an item");
    }).parse(detail)).toThrow("approval requested item name is required");
  });
});
