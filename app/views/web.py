"""
Web Views Blueprint for HTML template rendering, manifest serving, and session redirection.
"""

import os
from pathlib import Path
from flask import (
    Blueprint,
    current_app,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)

web_bp = Blueprint("web_bp", __name__)


def is_authenticated() -> bool:
    """Check if the current request carries an authenticated session."""
    return bool(session.get("user_id") or session.get("logged_in"))


@web_bp.before_app_request
def enforce_auth():
    """Intercept all web routes and redirect unauthenticated visitors to login."""
    path = request.path

    # Open whitelist paths
    open_exact = (
        "/login",
        "/logout",
        "/manifest.json",
        "/service-worker.js",
        "/favicon.ico",
    )
    if path in open_exact:
        return None

    # Open prefixes
    open_prefixes = (
        "/static/",
        "/api/auth/",
        "/s3/share/",
        "/api/s3/share/",
    )
    if any(path.startswith(prefix) for prefix in open_prefixes):
        return None

    if not is_authenticated():
        # If API request, return 401 JSON
        if path.startswith("/api/"):
            return jsonify({"ok": False, "error": "Authentication required."}), 401
        return redirect(url_for("web_bp.login_page", next=request.full_path))

    return None


@web_bp.route("/login", methods=["GET", "POST"])
def login_page():
    """Render modern multi-user login portal or process legacy password fallback."""
    if request.method == "POST":
        # Legacy form submission fallback
        password = request.form.get("password", "")
        next_path = request.form.get("next") or "/"
        configured_password = current_app.config.get("ENLACE_PASSWORD", "")

        if configured_password and password == configured_password:
            session["logged_in"] = True
            session.permanent = True
            return redirect(next_path)
        elif not configured_password:
            # If no password configured, permit local access
            session["logged_in"] = True
            session.permanent = True
            return redirect(next_path)

        return render_template("login.html", error="Contraseña incorrecta.", next_path=next_path)

    if is_authenticated():
        return redirect("/")

    return render_template("login.html", next_path=request.args.get("next", "/"))


@web_bp.route("/logout")
def logout():
    """Clear session and redirect to login portal."""
    session.clear()
    return redirect("/login")


@web_bp.route("/")
@web_bp.route("/desktop")
@web_bp.route("/pc")
@web_bp.route("/host")
def pc_view():
    """Render desktop control panel."""
    return render_template("pc.html")


@web_bp.route("/mobile")
def mobile_view():
    """Render mobile client interface."""
    default_type = "mobile"
    return render_template("remote.html", default_type=default_type)


@web_bp.route("/manifest.json")
def manifest():
    """Serve PWA manifest."""
    return send_from_directory(
        os.path.join(current_app.root_path, "..", "static"),
        "manifest.json",
        mimetype="application/manifest+json",
    )


@web_bp.route("/service-worker.js")
def service_worker():
    """Serve PWA service worker with root scope."""
    return send_from_directory(
        os.path.join(current_app.root_path, "..", "static"),
        "service-worker.js",
        mimetype="application/javascript",
    )
