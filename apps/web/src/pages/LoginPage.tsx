import { Building2, ShieldCheck } from "lucide-react";

export function LoginPage({ authorizeUrl }: { authorizeUrl: string }) {
  return (
    <main className="login-page">
      <section className="login-card">
        <span className="login-card__mark"><Building2 size={24} /></span>
        <h1>集团仓库管理系统</h1>
        <p>使用企业微信登录管理员后台</p>
        <a className="button button--primary login-card__button" href={authorizeUrl}>使用企业微信登录</a>
        <small><ShieldCheck size={14} />登录由企业微信统一身份认证</small>
      </section>
    </main>
  );
}
