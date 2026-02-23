from flask import current_app, g
from pymongo import MongoClient
from werkzeug.local import LocalProxy

class PyMongoProxy:
    """A simple proxy to hold the MongoClient instance."""
    def __init__(self):
        self.client = None
        self.db = None

    def init_app(self, app):
        """Initializes the MongoDB client using Flask app config."""
        if not app.config.get("MONGO_URI"):
            raise ValueError("MONGO_URI not set in configuration.")
            
        self.client = MongoClient(app.config["MONGO_URI"])
        self.db = self.client[app.config["MONGO_DBNAME"]]

mongo = PyMongoProxy()

# Helper function to access the database connection using LocalProxy
# This is a common pattern for thread-safe database access in Flask extensions
def get_db():
    """Proxy for accessing the MongoDB database instance."""
    if 'db' not in g:
        g.db = mongo.db
    return g.db

db = LocalProxy(get_db)
