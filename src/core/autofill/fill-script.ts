import type { AutofillPageDetails } from "./models";
import { qualifyLoginFields } from "./qualify-fields";

/**
 * 填充脚本。
 *
 * 背景页把"往哪个字段填什么"编译成一串极简指令交给页面执行，页面侧不需要
 * 知道任何密码库概念。这样注入到页面里的代码面可以压到最小。
 *
 * opid 是字段在采集列表中的下标标识，填充侧用同一个查询函数还原成元素。
 */

export type FillAction =
  | ["click_on_opid", string]
  | ["focus_by_opid", string]
  | ["fill_by_opid", string, string];

export interface FillScript {
  actions: FillAction[];
  /** 用于填充后向用户说明都填了什么，不含具体值。 */
  filledFieldCount: number;
}

export interface LoginCredentials {
  username?: string;
  password?: string;
}

/**
 * 生成登录填充脚本。
 *
 * 动作顺序刻意模仿真人操作：先点一下、聚焦、再写值。很多站点（尤其是带前端
 * 校验的）只在收到交互事件后才认这个值，直接赋值会被判为"未填写"。
 */
export function buildLoginFillScript(
  details: AutofillPageDetails,
  credentials: LoginCredentials,
): FillScript {
  const { usernameField, passwordFields } = qualifyLoginFields(details);
  const actions: FillAction[] = [];
  let filledFieldCount = 0;

  const username = credentials.username ?? "";
  const password = credentials.password ?? "";

  if (usernameField != null && username !== "") {
    actions.push(["click_on_opid", usernameField.opid]);
    actions.push(["focus_by_opid", usernameField.opid]);
    actions.push(["fill_by_opid", usernameField.opid, username]);
    filledFieldCount += 1;
  }

  if (password !== "") {
    for (const field of passwordFields) {
      actions.push(["click_on_opid", field.opid]);
      actions.push(["focus_by_opid", field.opid]);
      actions.push(["fill_by_opid", field.opid, password]);
      filledFieldCount += 1;
    }
  }

  // 收尾把焦点放回用户名，光标位置更符合"刚填完表单"的预期。
  if (actions.length > 0 && usernameField != null && username !== "") {
    actions.push(["focus_by_opid", usernameField.opid]);
  }

  return { actions, filledFieldCount };
}
