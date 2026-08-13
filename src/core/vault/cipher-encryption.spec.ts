import { describe, expect, it } from "vitest";

import { EncString, generateUserKey, wrapKey, encryptBytes, randomBytes } from "@/core/crypto";
import { SymmetricCryptoKey } from "@/core/crypto";

import { decryptCipher, decryptFolder, encryptCipher, encryptFolder } from "./cipher-encryption";
import { CipherRepromptType, CipherType, FieldType, SecureNoteType, UriMatchStrategy } from "./enums";
import type { Cipher, CipherView, EncryptedString } from "./models";

/**
 * 每个明文值都带唯一前缀 `PLAIN-`，便于在密文里全局搜索确认没有漏加密的字段。
 */
function fullyPopulatedCipher(): CipherView {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: CipherType.Login,
    name: "PLAIN-name",
    notes: "PLAIN-notes",
    favorite: true,
    reprompt: CipherRepromptType.Password,
    folderId: "22222222-2222-2222-2222-222222222222",
    organizationId: "33333333-3333-3333-3333-333333333333",
    collectionIds: ["44444444-4444-4444-4444-444444444444"],

    login: {
      username: "PLAIN-username",
      password: "PLAIN-password",
      totp: "PLAIN-totp",
      passwordRevisionDate: "2026-01-01T00:00:00.000Z",
      uris: [
        { uri: "PLAIN-uri", uriChecksum: "PLAIN-checksum", match: UriMatchStrategy.Host },
        { uri: "PLAIN-uri2", match: UriMatchStrategy.Never },
      ],
      fido2Credentials: [
        {
          credentialId: "PLAIN-credentialId",
          keyType: "PLAIN-keyType",
          keyAlgorithm: "PLAIN-keyAlgorithm",
          keyCurve: "PLAIN-keyCurve",
          keyValue: "PLAIN-keyValue",
          rpId: "PLAIN-rpId",
          userHandle: "PLAIN-userHandle",
          userName: "PLAIN-userName",
          counter: "PLAIN-counter",
          rpName: "PLAIN-rpName",
          userDisplayName: "PLAIN-userDisplayName",
          discoverable: "PLAIN-discoverable",
          creationDate: "2026-01-01T00:00:00.000Z",
        },
      ],
    },

    fields: [
      { name: "PLAIN-fieldName", value: "PLAIN-fieldValue", type: FieldType.Hidden, linkedId: 100 },
    ],
    passwordHistory: [
      { password: "PLAIN-oldPassword", lastUsedDate: "2025-01-01T00:00:00.000Z" },
    ],

    creationDate: "2026-01-01T00:00:00.000Z",
    revisionDate: "2026-02-01T00:00:00.000Z",
    deletedDate: "2026-03-01T00:00:00.000Z",
    archivedDate: "2026-04-01T00:00:00.000Z",
  };
}

/** 覆盖除 Login 外的所有子结构，确保没有类型被漏掉。 */
function allTypeStructs(): CipherView {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    type: CipherType.Identity,
    name: "PLAIN-name",
    favorite: false,
    reprompt: CipherRepromptType.None,
    creationDate: "2026-01-01T00:00:00.000Z",
    revisionDate: "2026-01-01T00:00:00.000Z",

    secureNote: { type: SecureNoteType.Generic },
    card: {
      cardholderName: "PLAIN-cardholderName",
      brand: "PLAIN-brand",
      number: "PLAIN-number",
      expMonth: "PLAIN-expMonth",
      expYear: "PLAIN-expYear",
      code: "PLAIN-code",
    },
    identity: {
      title: "PLAIN-title",
      firstName: "PLAIN-firstName",
      middleName: "PLAIN-middleName",
      lastName: "PLAIN-lastName",
      address1: "PLAIN-address1",
      address2: "PLAIN-address2",
      address3: "PLAIN-address3",
      city: "PLAIN-city",
      state: "PLAIN-state",
      postalCode: "PLAIN-postalCode",
      country: "PLAIN-country",
      company: "PLAIN-company",
      email: "PLAIN-email",
      phone: "PLAIN-phone",
      ssn: "PLAIN-ssn",
      username: "PLAIN-username",
      passportNumber: "PLAIN-passportNumber",
      licenseNumber: "PLAIN-licenseNumber",
    },
    sshKey: {
      privateKey: "PLAIN-privateKey",
      publicKey: "PLAIN-publicKey",
      keyFingerprint: "PLAIN-keyFingerprint",
    },
    bankAccount: {
      bankName: "PLAIN-bankName",
      nameOnAccount: "PLAIN-nameOnAccount",
      accountType: "PLAIN-accountType",
      accountNumber: "PLAIN-accountNumber",
      routingNumber: "PLAIN-routingNumber",
      branchNumber: "PLAIN-branchNumber",
      pin: "PLAIN-pin",
      swiftCode: "PLAIN-swiftCode",
      iban: "PLAIN-iban",
      bankContactPhone: "PLAIN-bankContactPhone",
    },
    driversLicense: {
      firstName: "PLAIN-dlFirstName",
      middleName: "PLAIN-dlMiddleName",
      lastName: "PLAIN-dlLastName",
      dateOfBirth: "PLAIN-dlDateOfBirth",
      licenseNumber: "PLAIN-dlLicenseNumber",
      issuingCountry: "PLAIN-dlIssuingCountry",
      issuingState: "PLAIN-dlIssuingState",
      issueDate: "PLAIN-dlIssueDate",
      expirationDate: "PLAIN-dlExpirationDate",
      issuingAuthority: "PLAIN-dlIssuingAuthority",
      licenseClass: "PLAIN-dlLicenseClass",
    },
    passport: {
      surname: "PLAIN-surname",
      givenName: "PLAIN-givenName",
      dateOfBirth: "PLAIN-ppDateOfBirth",
      sex: "PLAIN-sex",
      birthPlace: "PLAIN-birthPlace",
      nationality: "PLAIN-nationality",
      issuingCountry: "PLAIN-ppIssuingCountry",
      passportNumber: "PLAIN-ppPassportNumber",
      passportType: "PLAIN-passportType",
      nationalIdentificationNumber: "PLAIN-nationalIdentificationNumber",
      issuingAuthority: "PLAIN-ppIssuingAuthority",
      issueDate: "PLAIN-ppIssueDate",
      expirationDate: "PLAIN-ppExpirationDate",
    },
  };
}

describe("条目加解密往返", () => {
  it("完整登录条目往返后逐字段相等", async () => {
    const userKey = generateUserKey();
    const view = fullyPopulatedCipher();

    const decrypted = await decryptCipher(await encryptCipher(view, userKey), userKey);

    expect(decrypted).toEqual(view);
  });

  it("覆盖全部条目子结构的往返", async () => {
    const userKey = generateUserKey();
    const view = allTypeStructs();

    const decrypted = await decryptCipher(await encryptCipher(view, userKey), userKey);

    expect(decrypted).toEqual(view);
  });

  it("密文里不残留任何明文", async () => {
    // 这是本模块最重要的一条测试：把加密结果整体序列化，全局搜 "PLAIN-"。
    // 任何字段漏进加密路径都会在这里暴露。
    const userKey = generateUserKey();

    for (const view of [fullyPopulatedCipher(), allTypeStructs()]) {
      const serialized = JSON.stringify(await encryptCipher(view, userKey));
      expect(serialized).not.toContain("PLAIN-");
    }
  });

  it("非敏感元数据保持明文，锁定态下仍可统计与排序", async () => {
    const userKey = generateUserKey();
    const view = fullyPopulatedCipher();

    const cipher = await encryptCipher(view, userKey);

    expect(cipher.id).toBe(view.id);
    expect(cipher.type).toBe(view.type);
    expect(cipher.favorite).toBe(true);
    expect(cipher.reprompt).toBe(CipherRepromptType.Password);
    expect(cipher.folderId).toBe(view.folderId);
    expect(cipher.creationDate).toBe(view.creationDate);
    expect(cipher.deletedDate).toBe(view.deletedDate);
    expect(cipher.login?.uris?.[0]?.match).toBe(UriMatchStrategy.Host);
    expect(cipher.fields?.[0]?.type).toBe(FieldType.Hidden);
    expect(cipher.fields?.[0]?.linkedId).toBe(100);
  });

  it("敏感字段确实是 type 2 密文", async () => {
    const userKey = generateUserKey();

    const cipher = await encryptCipher(fullyPopulatedCipher(), userKey);

    for (const value of [cipher.name, cipher.notes, cipher.login?.username, cipher.login?.password]) {
      expect(EncString.isSerialized(value as string)).toBe(true);
      expect(EncString.parse(value as string).encryptionType).toBe(2);
    }
  });

  it("可选字段缺失时不会凭空造出来", async () => {
    const userKey = generateUserKey();
    const minimal: CipherView = {
      id: "66666666-6666-6666-6666-666666666666",
      type: CipherType.SecureNote,
      name: "只有名字",
      favorite: false,
      reprompt: CipherRepromptType.None,
      secureNote: { type: SecureNoteType.Generic },
      creationDate: "2026-01-01T00:00:00.000Z",
      revisionDate: "2026-01-01T00:00:00.000Z",
    };

    const cipher = await encryptCipher(minimal, userKey);

    expect(cipher.notes).toBeUndefined();
    expect(cipher.login).toBeUndefined();
    expect(cipher.fields).toBeUndefined();
    expect(await decryptCipher(cipher, userKey)).toEqual(minimal);
  });
});

describe("字段规格表的防漏机制", () => {
  it("遇到未登记字段直接抛错而不是静默明文落盘", async () => {
    const userKey = generateUserKey();
    const rogue = {
      ...fullyPopulatedCipher(),
      // 模拟"给模型加了字段却忘了登记"的情形。
      secretBackdoor: "PLAIN-leaked",
    } as unknown as CipherView;

    await expect(encryptCipher(rogue, userKey)).rejects.toThrow(/未登记字段 "secretBackdoor"/);
  });
});

describe("per-cipher key", () => {
  it("能解密带自有密钥的条目（Bitwarden 新版会产出这种数据）", async () => {
    const userKey = generateUserKey();
    const cipherKey = new SymmetricCryptoKey(randomBytes(64));

    // 手工构造：字段用 cipherKey 加密，cipherKey 本身用 UserKey 包裹。
    const encryptedWithCipherKey = await encryptCipher(
      {
        id: "77777777-7777-7777-7777-777777777777",
        type: CipherType.Login,
        name: "带自有密钥",
        favorite: false,
        reprompt: CipherRepromptType.None,
        login: { password: "PLAIN-secret" },
        creationDate: "2026-01-01T00:00:00.000Z",
        revisionDate: "2026-01-01T00:00:00.000Z",
      },
      cipherKey,
    );

    const withKey: Cipher = {
      ...encryptedWithCipherKey,
      key: (await wrapKey(cipherKey, userKey)).toString() as EncryptedString,
    };

    const decrypted = await decryptCipher(withKey, userKey);

    expect(decrypted.login?.password).toBe("PLAIN-secret");
  });

  it("我们自己加密时不产出 key 字段", async () => {
    const cipher = await encryptCipher(fullyPopulatedCipher(), generateUserKey());
    expect(cipher.key).toBeUndefined();
  });

  it("用错 UserKey 解不开自有密钥", async () => {
    const userKey = generateUserKey();
    const cipherKey = new SymmetricCryptoKey(randomBytes(64));
    const base = await encryptCipher(
      {
        id: "88888888-8888-8888-8888-888888888888",
        type: CipherType.Login,
        name: "x",
        favorite: false,
        reprompt: CipherRepromptType.None,
        creationDate: "2026-01-01T00:00:00.000Z",
        revisionDate: "2026-01-01T00:00:00.000Z",
      },
      cipherKey,
    );
    const withKey: Cipher = {
      ...base,
      key: (await wrapKey(cipherKey, userKey)).toString() as EncryptedString,
    };

    await expect(decryptCipher(withKey, generateUserKey())).rejects.toThrow(/MAC/);
  });
});

describe("文件夹加解密", () => {
  it("名称加密，id 与时间保持明文", async () => {
    const userKey = generateUserKey();
    const view = {
      id: "99999999-9999-9999-9999-999999999999",
      name: "PLAIN-folderName",
      revisionDate: "2026-01-01T00:00:00.000Z",
    };

    const folder = await encryptFolder(view, userKey);

    expect(folder.id).toBe(view.id);
    expect(folder.revisionDate).toBe(view.revisionDate);
    expect(JSON.stringify(folder)).not.toContain("PLAIN-");
    expect(await decryptFolder(folder, userKey)).toEqual(view);
  });
});

describe("加密结果的不可预测性", () => {
  it("同一条目加密两次得到不同密文（IV 随机）", async () => {
    const userKey = generateUserKey();
    const view = fullyPopulatedCipher();

    const first = await encryptCipher(view, userKey);
    const second = await encryptCipher(view, userKey);

    expect(first.name).not.toBe(second.name);
    // 但解出来必须一致。
    expect(await decryptCipher(first, userKey)).toEqual(await decryptCipher(second, userKey));
  });

  it("未使用的加密入口仍可用（encryptBytes 走同一套原语）", async () => {
    const encrypted = await encryptBytes(new Uint8Array([1, 2, 3]), generateUserKey());
    expect(encrypted.encryptionType).toBe(2);
  });
});
