import { useEffect, useState } from "react";
import { User, Moon, Lock, LogOut } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "../../hooks/useAuth";
import { authService } from "../../services/authService";
import { writeSessionCache } from "../../lib/cache";

export function SettingsPage() {
  const navigate = useNavigate();
  const { profile, refreshProfile, signOut, user } = useAuth();
  const [darkMode, setDarkMode] = useState(false);
  const [name, setName] = useState(profile?.full_name ?? "");
  const [email, setEmail] = useState(profile?.email ?? user?.email ?? "");
  const [educationLevel, setEducationLevel] = useState(profile?.education_level ?? "undergraduate");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(profile?.full_name ?? "");
    setEmail(profile?.email ?? user?.email ?? "");
    setEducationLevel(profile?.education_level ?? "undergraduate");
    setDarkMode(
      Boolean(
        typeof profile?.preferences === "object" &&
          profile.preferences &&
          "darkMode" in profile.preferences
          ? profile.preferences.darkMode
          : false,
      ),
    );
  }, [profile, user]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    writeSessionCache("theme.darkMode", darkMode);
  }, [darkMode]);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      return;
    }

    setIsSaving(true);
    setMessage(null);
    setError(null);

    void authService
      .upsertProfile({
        id: user.id,
        full_name: name,
        email,
        education_level: educationLevel,
        preferences: {
          ...(typeof profile?.preferences === "object" && profile.preferences ? profile.preferences : {}),
          darkMode,
        },
      })
      .then(async () => {
        await refreshProfile();
        setMessage("Profile updated successfully.");
      })
      .catch((saveError) => {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Unable to save your changes.",
        );
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const handleChangePassword = () => {
    setMessage(null);
    setError(null);

    const nextPassword = window.prompt("Enter your new password");

    if (!nextPassword) {
      return;
    }

    if (nextPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    void authService
      .updatePassword(nextPassword)
      .then(() => {
        setMessage("Password updated successfully.");
      })
      .catch((passwordError) => {
        if (
          passwordError instanceof Error &&
          passwordError.message.toLowerCase().includes("reauthentication")
        ) {
          void authService.sendPasswordReset(email).then(() => {
            setMessage("For security, a reset email was sent instead. Check your inbox.");
          });
          return;
        }

        setError(
          passwordError instanceof Error
            ? passwordError.message
            : "Unable to update your password.",
        );
      });
  };

  const handleLogout = () => {
    void signOut().then(() => {
      navigate("/login");
    });
  };

  return (
    <div className="h-full overflow-auto bg-gray-50">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your account and preferences</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto p-8">
        {/* Profile Section */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
            <User className="w-5 h-5" />
            Profile Information
          </h2>

          <form onSubmit={handleSaveProfile} className="space-y-6">
            {message ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {message}
              </div>
            ) : null}
            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}
            {/* Profile Picture */}
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 bg-gray-300 rounded-full flex items-center justify-center">
                <span className="text-2xl font-medium text-gray-700">JD</span>
              </div>
              <button
                type="button"
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Change Photo
              </button>
            </div>

            {/* Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Education Level */}
            <div>
              <label htmlFor="education" className="block text-sm font-medium text-gray-700 mb-2">
                Education Level
              </label>
              <select
                id="education"
                value={educationLevel}
                onChange={(e) => setEducationLevel(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                <option value="high-school">High School</option>
                <option value="undergraduate">Undergraduate</option>
                <option value="graduate">Graduate</option>
                <option value="phd">PhD</option>
                <option value="professional">Professional</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </form>
        </div>

        {/* Preferences Section */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Preferences</h2>

          <div className="space-y-6">
            {/* Dark Mode */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Moon className="w-5 h-5 text-gray-600" />
                <div>
                  <div className="font-medium text-gray-900">Dark Mode</div>
                  <div className="text-sm text-gray-500">Enable dark theme for the interface</div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={darkMode}
                  onChange={(e) => setDarkMode(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

          </div>
        </div>

        {/* Account Actions */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Account</h2>

          <div className="space-y-4">
            {/* Change Password */}
            <button
              onClick={handleChangePassword}
              className="w-full flex items-center justify-between px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Lock className="w-5 h-5 text-gray-600" />
                <span className="font-medium text-gray-900">Change Password</span>
              </div>
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-between px-4 py-3 border border-red-300 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <LogOut className="w-5 h-5 text-red-600" />
                <span className="font-medium text-red-700">Logout</span>
              </div>
            </button>
          </div>
        </div>

        {/* App Info */}
        <div className="mt-8 text-center text-sm text-gray-500">
          LearnLoop v1.0.0 • Made with ❤️ for learners
        </div>
      </div>
    </div>
  );
}
